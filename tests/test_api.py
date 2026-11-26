"""가짜 instagrapi 클라이언트로 API 전체 흐름 테스트."""
import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from instagrapi import exceptions as E

from app import ig, main


def U(n):
    return SimpleNamespace(pk=n, username=f"user{n}", full_name=f"User {n}", profile_pic_url=None,
                           is_private=n % 7 == 0, is_verified=n == 1)


class FakeClient:
    mode = "ok"  # ok | 2fa | challenge | badpw
    followers = list(range(1, 121))
    following = list(range(80, 201))
    calls = 0

    def __init__(self, settings=None):
        self.settings = settings or {}
        self.challenge_code_handler = None
        self.user_id = 999 if settings else None

    def login(self, username, password, verification_code=""):
        if password != "pw" or FakeClient.mode == "badpw":
            raise E.BadPassword("bad")
        if FakeClient.mode == "2fa" and verification_code != "123456":
            if verification_code:
                raise E.ClientError("wrong code")
            raise E.TwoFactorRequired("need")
        if FakeClient.mode == "challenge":
            code = self.challenge_code_handler(username, "ChallengeChoice.EMAIL")
            if code != "654321":
                raise E.ChallengeRequired("bad")
        self.user_id = 999
        return True

    def user_info_v1(self, uid):
        return SimpleNamespace(**{**vars(U(999)), "username": "me"}, follower_count=len(self.followers),
                               following_count=len(self.following))

    def get_settings(self):
        return {"authorization_data": {"ds_user_id": "999"}, "n": 1}

    def _chunk(self, ids, max_amount, max_id):
        FakeClient.calls += 1
        if FakeClient.mode == "ratelimit" and FakeClient.calls == 1:
            raise E.PleaseWaitFewMinutes("wait")
        if FakeClient.mode == "expired":
            raise E.LoginRequired("expired")
        s = int(max_id or 0)
        nxt = s + max_amount
        return [U(n) for n in ids[s:nxt]], (str(nxt) if nxt < len(ids) else None)

    def user_followers_v1_chunk(self, uid, max_amount=0, max_id=""):
        return self._chunk(self.followers, max_amount, max_id)

    def user_following_v1_chunk(self, uid, max_amount=0, max_id=""):
        return self._chunk(self.following, max_amount, max_id)


@pytest.fixture(autouse=True)
def fake(monkeypatch):
    FakeClient.mode = "ok"
    FakeClient.calls = 0
    monkeypatch.setattr(ig, "make_client", lambda settings=None: FakeClient(settings))
    monkeypatch.setattr(ig.random, "uniform", lambda a, b: 0)
    monkeypatch.setattr(ig, "PAGE_SIZE", 50)
    monkeypatch.setattr(main, "ACCESS_CODE", "")
    yield


client = TestClient(main.app)


def wait_status(path, until=("ok", "error", "need_code", "auth", "cancelled"), timeout=5):
    end = time.time() + timeout
    while time.time() < end:
        d = client.get(path).json()
        if d["status"] in until:
            return d
        time.sleep(0.02)
    raise AssertionError("timeout: " + str(d))


def login(username="me", password="pw"):
    r = client.post("/api/login", json={"username": username, "password": password})
    assert r.status_code == 200
    return r.json()["job"]


def test_static_and_config():
    assert client.get("/").status_code == 200
    assert "followcheck" in client.get("/").text
    assert client.get("/api/config").json() == {"access_required": False}


def test_login_ok_and_scan():
    d = wait_status(f"/api/login/{login()}")
    assert d["status"] == "ok" and d["user"]["username"] == "me" and d["user"]["followers"] == 120
    token = d["token"]
    assert "pw" not in token

    job = client.post("/api/scan", json={"token": token}).json()["job"]
    s = wait_status(f"/api/scan/{job}")
    assert s["status"] == "ok", s
    res = s["result"]
    assert len(res["followers"]) == 120 and len(res["following"]) == 121
    assert res["followers"][0] == {"id": "1", "username": "user1", "name": "User 1", "pic": "", "priv": False, "ver": True}
    assert s["token"]


def test_bad_password():
    d = wait_status(f"/api/login/{login(password='nope')}")
    assert d["status"] == "error" and "비밀번호" in d["message"]


def test_two_factor_with_retry():
    FakeClient.mode = "2fa"
    job = login()
    d = wait_status(f"/api/login/{job}", until=("need_code",))
    assert d["code_kind"] == "two_factor" and d["code_round"] == 1
    client.post(f"/api/login/{job}/code", json={"code": "000000"})
    d = wait_status(f"/api/login/{job}", until=("need_code",))
    while d["code_round"] == 1:
        d = wait_status(f"/api/login/{job}", until=("need_code",))
    assert d["code_round"] == 2 and "코드" in d["message"]
    client.post(f"/api/login/{job}/code", json={"code": "123456"})
    assert wait_status(f"/api/login/{job}", until=("ok", "error"))["status"] == "ok"


def test_challenge_email_code():
    FakeClient.mode = "challenge"
    job = login()
    d = wait_status(f"/api/login/{job}", until=("need_code",))
    assert d["code_kind"] == "challenge" and d["code_method"] == "email"
    client.post(f"/api/login/{job}/code", json={"code": "654321"})
    assert wait_status(f"/api/login/{job}", until=("ok", "error"))["status"] == "ok"


def test_bad_token_and_expired_session():
    assert client.post("/api/scan", json={"token": "x" * 40}).status_code == 401
    token = main.seal({"authorization_data": {"ds_user_id": "999"}})
    FakeClient.mode = "expired"
    job = client.post("/api/scan", json={"token": token}).json()["job"]
    assert wait_status(f"/api/scan/{job}")["status"] == "auth"


def test_cancel():
    token = main.seal({"a": 1})
    FakeClient.mode = "ratelimit"  # 첫 요청에서 대기 상태로 진입
    job = client.post("/api/scan", json={"token": token}).json()["job"]
    time.sleep(0.2)
    d = client.get(f"/api/scan/{job}").json()
    assert d["status"] == "running" and "요청 제한" in d["progress"]["note"]
    client.post(f"/api/scan/{job}/cancel")
    assert wait_status(f"/api/scan/{job}")["status"] == "cancelled"


def test_access_code(monkeypatch):
    monkeypatch.setattr(main, "ACCESS_CODE", "secret")
    assert client.get("/api/config").json() == {"access_required": True}
    assert client.post("/api/login", json={"username": "me", "password": "pw"}).status_code == 403
    r = client.post("/api/login", json={"username": "me", "password": "pw"}, headers={"X-Access-Code": "secret"})
    assert r.status_code == 200
