"""followcheck API 서버 + 웹앱 정적 파일.

세션(인스타 로그인 정보)은 서버에 저장하지 않습니다. 로그인에 성공하면
세션을 SECRET_KEY로 암호화한 토큰으로 돌려주고, 브라우저가 그 토큰을 보관합니다.
비밀번호는 로그인에만 쓰이고 어디에도 저장되지 않습니다.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import ig

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("followcheck")

WEB_DIR = Path(__file__).resolve().parent.parent / "docs"

_secret = os.environ.get("SECRET_KEY")
if not _secret:
    _secret = secrets.token_urlsafe(32)
    log.warning("SECRET_KEY 가 없어 임시 키를 사용합니다. 서버가 재시작되면 다시 로그인해야 해요.")
FERNET = Fernet(base64.urlsafe_b64encode(hashlib.sha256(_secret.encode()).digest()))
ACCESS_CODE = os.environ.get("ACCESS_CODE", "")

jobs = ig.JobStore()
app = FastAPI(title="followcheck", docs_url=None, redoc_url=None, openapi_url=None)

# GitHub Pages(https://hxvibe.github.io/followcheck/)에 올린 화면에서 이 서버를 부를 수 있게 허용
ALLOWED_ORIGINS = [o.strip().rstrip("/") for o in
                   os.environ.get("ALLOWED_ORIGINS", "https://hxvibe.github.io").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Access-Code"],
    max_age=600,
)


# ---------- 공통 ----------
def check_access(code: Optional[str]) -> None:
    if ACCESS_CODE and not hmac.compare_digest((code or "").encode(), ACCESS_CODE.encode()):
        raise HTTPException(403, "접근 코드가 맞지 않아요.")


def seal(settings: dict) -> str:
    return FERNET.encrypt(json.dumps(settings, separators=(",", ":")).encode()).decode()


def unseal(token: str) -> dict:
    try:
        return json.loads(FERNET.decrypt(token.encode()))
    except (InvalidToken, ValueError):
        raise HTTPException(401, "로그인이 만료됐어요. 다시 로그인해 주세요.")


def no_store(data: dict, status: int = 200) -> JSONResponse:
    return JSONResponse(data, status_code=status, headers={"Cache-Control": "no-store"})


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class CodeIn(BaseModel):
    code: str = Field(min_length=4, max_length=12)


class TokenIn(BaseModel):
    token: str = Field(min_length=10, max_length=60000)


# ---------- API ----------
@app.get("/api/config")
def config():
    return no_store({"access_required": bool(ACCESS_CODE)})


@app.post("/api/login")
def login(body: LoginIn, x_access_code: Optional[str] = Header(None)):
    check_access(x_access_code)
    job = jobs.add(ig.LoginJob(body.username, body.password).start())
    return no_store({"job": job.id})


@app.get("/api/login/{job_id}")
def login_status(job_id: str):
    job = jobs.get(job_id, ig.LoginJob)
    if not job:
        raise HTTPException(404, "로그인 요청을 찾을 수 없어요. 다시 시도해 주세요.")
    data = job.public()
    if job.status == "ok":
        data.update(token=seal(job.settings), user=job.user)
    return no_store(data)


@app.post("/api/login/{job_id}/code")
def login_code(job_id: str, body: CodeIn):
    job = jobs.get(job_id, ig.LoginJob)
    if not job or job.status != "need_code":
        raise HTTPException(409, "지금은 코드를 받을 수 없어요. 다시 로그인해 주세요.")
    job.submit_code(body.code)
    return no_store({"ok": True})


@app.post("/api/scan")
def scan(body: TokenIn, x_access_code: Optional[str] = Header(None)):
    check_access(x_access_code)
    settings = unseal(body.token)
    job = jobs.add(ig.ScanJob(settings).start())
    return no_store({"job": job.id})


@app.get("/api/scan/{job_id}")
def scan_status(job_id: str):
    job = jobs.get(job_id, ig.ScanJob)
    if not job:
        raise HTTPException(404, "확인 작업을 찾을 수 없어요. 다시 시도해 주세요.")
    data = job.public()
    if job.status == "ok":
        data.update(result=job.result, token=seal(job.new_settings))
    return no_store(data)


@app.post("/api/scan/{job_id}/cancel")
def scan_cancel(job_id: str):
    job = jobs.get(job_id, ig.ScanJob)
    if job:
        job.cancel()
    return no_store({"ok": True})


@app.get("/healthz")
def healthz():
    return {"ok": True}


# ---------- 웹앱 ----------
app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
