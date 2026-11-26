"""인스타그램 앱(비공식 모바일 API) 연동 — instagrapi 기반.

로그인/스캔은 오래 걸리거나 중간에 인증 코드를 기다려야 해서
백그라운드 스레드 작업(Job)으로 돌리고, 프론트엔드는 상태를 폴링합니다.
"""
from __future__ import annotations

import logging
import os
import queue
import random
import secrets
import threading
import time
from typing import Any, Callable, Dict, List, Optional

from instagrapi import Client
from instagrapi import exceptions as E

log = logging.getLogger("followcheck")

JOB_TTL = 60 * 30  # 끝난 작업은 30분 뒤 정리
CODE_TIMEOUT = 60 * 5  # 인증 코드 대기 5분
PAGE_SIZE = 100


def make_client(settings: Optional[dict] = None) -> Client:
    """인스타그램 안드로이드 앱처럼 동작하는 클라이언트."""
    cl = Client(settings) if settings else Client()
    cl.delay_range = [1, 3]
    if not settings:
        cl.set_locale("ko_KR")
        cl.set_country("KR")
        cl.set_country_code(82)
        cl.set_timezone_offset(9 * 3600)
    proxy = os.environ.get("IG_PROXY")
    if proxy:
        cl.set_proxy(proxy)
    return cl


class CodeTimeout(Exception):
    pass


class Cancelled(Exception):
    pass


def friendly_error(e: Exception) -> str:
    if isinstance(e, (E.BadPassword, E.BadCredentials)):
        return "아이디 또는 비밀번호가 맞지 않아요."
    if isinstance(e, CodeTimeout):
        return "인증 코드 입력 시간(5분)이 지났어요. 다시 로그인해 주세요."
    if isinstance(e, (E.PleaseWaitFewMinutes, E.RateLimitError, E.ClientThrottledError)):
        return "인스타그램이 잠시 요청을 막았어요. 몇 분 뒤 다시 시도해 주세요."
    if isinstance(e, E.FeedbackRequired):
        return "인스타그램이 이 계정의 요청을 일시적으로 제한했어요. 몇 시간 뒤 다시 시도해 주세요."
    if isinstance(e, (E.ChallengeRequired, E.ChallengeError, E.ChallengeRedirection, E.ChallengeUnknownStep,
                      E.ChallengeSelfieCaptcha, E.CaptchaChallengeRequired, E.RecaptchaChallengeForm)):
        return ("인스타그램이 추가 본인 확인을 요구해요. 인스타 앱에서 '본인이 맞아요' 알림을 승인하거나 "
                "보안 확인을 마친 뒤 다시 로그인해 주세요.")
    if isinstance(e, E.ProxyAddressIsBlocked):
        return "이 서버의 IP가 인스타그램에 차단됐어요. 집 PC에서 실행하거나 IG_PROXY를 설정해 주세요."
    if isinstance(e, E.SentryBlock):
        return "인스타그램이 이 서버의 접속을 차단했어요. 잠시 후 다시 시도하거나 다른 네트워크에서 실행해 주세요."
    if isinstance(e, (E.LoginRequired, E.ClientLoginRequired)):
        return "로그인이 만료됐어요. 다시 로그인해 주세요."
    return f"알 수 없는 오류가 발생했어요. ({type(e).__name__})"


def _user_dict(u: Any) -> Dict[str, Any]:
    return {
        "id": str(u.pk),
        "username": u.username,
        "name": u.full_name or "",
        "pic": str(u.profile_pic_url) if u.profile_pic_url else "",
        "priv": bool(u.is_private),
        "ver": bool(u.is_verified),
    }


class Job:
    def __init__(self) -> None:
        self.id = secrets.token_urlsafe(18)
        self.status = "running"
        self.message = ""
        self.created = time.time()
        self.finished: Optional[float] = None
        self.lock = threading.Lock()

    def finish(self, status: str, message: str = "") -> None:
        with self.lock:
            self.status = status
            self.message = message
            self.finished = time.time()

    def start(self) -> "Job":
        threading.Thread(target=self._run_safe, daemon=True).start()
        return self

    def _run_safe(self) -> None:
        try:
            self.run()
        except Exception as e:  # noqa: BLE001
            log.warning("job %s failed: %r", type(self).__name__, e)
            self.finish("error", friendly_error(e))

    def run(self) -> None:  # pragma: no cover
        raise NotImplementedError


class LoginJob(Job):
    """아이디/비번으로 로그인. 2단계 인증·보안 확인 코드는 프론트에서 받아 전달."""

    def __init__(self, username: str, password: str) -> None:
        super().__init__()
        self.username = username.strip().lstrip("@")
        self.password = password
        self.code_kind: Optional[str] = None  # two_factor | challenge
        self.code_method: Optional[str] = None  # sms | email | app
        self.code_round = 0  # 코드를 요청할 때마다 증가 (프론트가 새 요청을 구분)
        self._codes: "queue.Queue[str]" = queue.Queue()
        self.settings: Optional[dict] = None
        self.user: Optional[dict] = None

    def submit_code(self, code: str) -> None:
        self._codes.put(code.strip().replace(" ", ""))

    def _wait_code(self, kind: str, method: str, message: str = "") -> str:
        with self.lock:
            self.status = "need_code"
            self.code_round += 1
            self.code_kind = kind
            self.code_method = method
            self.message = message
        try:
            code = self._codes.get(timeout=CODE_TIMEOUT)
        except queue.Empty:
            raise CodeTimeout()
        with self.lock:
            self.status = "running"
            self.message = ""
        return code

    def run(self) -> None:
        cl = make_client()

        def challenge_handler(username: str, choice: Any) -> str:
            method = "email" if "EMAIL" in str(choice).upper() else "sms"
            return self._wait_code("challenge", method)

        cl.challenge_code_handler = challenge_handler
        try:
            cl.login(self.username, self.password)
        except E.TwoFactorRequired:
            msg = ""
            for attempt in range(3):
                code = self._wait_code("two_factor", "app", msg)
                try:
                    cl.login(self.username, self.password, verification_code=code)
                    break
                except (E.BadPassword, E.BadCredentials, E.PleaseWaitFewMinutes, E.FeedbackRequired):
                    raise
                except Exception as e:  # 코드 오류 → 다시 입력
                    log.info("2fa attempt failed: %r", e)
                    if attempt == 2:
                        raise
                    msg = "코드가 맞지 않거나 만료됐어요. 새 코드를 입력해 주세요."
        info = cl.user_info_v1(str(cl.user_id))
        self.user = {
            **_user_dict(info),
            "followers": info.follower_count,
            "following": info.following_count,
        }
        self.settings = cl.get_settings()
        self.password = ""
        self.finish("ok")

    def public(self) -> Dict[str, Any]:
        with self.lock:
            return {
                "status": self.status,
                "message": self.message,
                "code_kind": self.code_kind,
                "code_method": self.code_method,
                "code_round": self.code_round,
            }


class ScanJob(Job):
    """팔로워/팔로잉 전체 목록을 천천히 페이지 단위로 가져온다."""

    def __init__(self, settings: dict) -> None:
        super().__init__()
        self.settings = settings
        self.cancelled = False
        self.progress = {"followers": 0, "following": 0, "followers_total": None,
                         "following_total": None, "phase": "me", "note": ""}
        self.result: Optional[dict] = None
        self.new_settings: Optional[dict] = None

    def cancel(self) -> None:
        self.cancelled = True

    def _sleep(self, seconds: float, note: str = "") -> None:
        end = time.time() + seconds
        while time.time() < end:
            if self.cancelled:
                raise Cancelled()
            if note:
                self.progress["note"] = f"{note} ({int(end - time.time()) + 1}초)"
            time.sleep(min(1.0, max(0.0, end - time.time())))
        self.progress["note"] = ""

    def _call(self, fn: Callable, *args: Any, **kw: Any) -> Any:
        for attempt in range(4):
            if self.cancelled:
                raise Cancelled()
            try:
                return fn(*args, **kw)
            except (E.PleaseWaitFewMinutes, E.RateLimitError, E.ClientThrottledError):
                if attempt == 3:
                    raise
                self._sleep(60 * (attempt + 1), "요청 제한 — 기다렸다가 이어서 진행")
        raise RuntimeError("unreachable")

    def _fetch_all(self, cl: Client, kind: str) -> List[Dict[str, Any]]:
        fn = cl.user_followers_v1_chunk if kind == "followers" else cl.user_following_v1_chunk
        uid = str(cl.user_id)
        out: Dict[str, Dict[str, Any]] = {}
        max_id = ""
        page = 0
        while True:
            users, max_id = self._call(fn, uid, max_amount=PAGE_SIZE, max_id=max_id)
            for u in users:
                d = _user_dict(u)
                out[d["id"]] = d
            self.progress[kind] = len(out)
            page += 1
            if not max_id:
                break
            self._sleep(random.uniform(4, 7) if page % 10 == 0 else random.uniform(0.8, 1.8))
        return list(out.values())

    def run(self) -> None:
        try:
            cl = make_client(self.settings)
            if not cl.user_id:
                raise E.LoginRequired()
            me = self._call(cl.user_info_v1, str(cl.user_id))
            self.progress.update(followers_total=me.follower_count, following_total=me.following_count,
                                 phase="followers")
            followers = self._fetch_all(cl, "followers")
            self._sleep(random.uniform(1.5, 3))
            self.progress["phase"] = "following"
            following = self._fetch_all(cl, "following")
            self.progress["phase"] = "done"
            self.result = {
                "me": {**_user_dict(me), "followers": me.follower_count, "following": me.following_count},
                "followers": followers,
                "following": following,
                "at": int(time.time() * 1000),
            }
            self.new_settings = cl.get_settings()
            self.finish("ok")
        except Cancelled:
            self.finish("cancelled", "중지했어요.")
        except (E.LoginRequired, E.ClientLoginRequired):
            self.finish("auth", "로그인이 만료됐어요. 다시 로그인해 주세요.")

    def public(self) -> Dict[str, Any]:
        return {"status": self.status, "message": self.message, "progress": dict(self.progress)}


class JobStore:
    def __init__(self) -> None:
        self._jobs: Dict[str, Job] = {}
        self._lock = threading.Lock()

    def add(self, job: Job) -> Job:
        with self._lock:
            self._gc()
            self._jobs[job.id] = job
        return job

    def get(self, job_id: str, kind: type) -> Optional[Any]:
        with self._lock:
            self._gc()
            job = self._jobs.get(job_id)
        return job if isinstance(job, kind) else None

    def _gc(self) -> None:
        now = time.time()
        for k in [k for k, j in self._jobs.items()
                  if (j.finished and now - j.finished > JOB_TTL) or now - j.created > JOB_TTL * 4]:
            self._jobs.pop(k, None)
