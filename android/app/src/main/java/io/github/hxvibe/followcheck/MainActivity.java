package io.github.hxvibe.followcheck;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.Window;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/**
 * 인스타그램 웹을 앱 안에서 열고, 로그인되어 있으면 followcheck 화면을 자동으로 띄운다.
 * 로그인은 인스타그램의 실제 로그인 화면에서 하므로 2단계 인증·보안 확인도 그대로 처리된다.
 * 서버 없음: 모든 요청은 이 폰에서 인스타그램으로 직접 간다.
 */
public class MainActivity extends Activity {

    private static final String HOME = "https://www.instagram.com/";
    private static final String HOST_CHECK = "(function(){return !!document.getElementById('__followcheck_host__')})()";
    private static final Pattern USERNAME = Pattern.compile("^[A-Za-z0-9._]{1,30}$");
    private static final long TICK_MS = 1200;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private String script;
    private boolean hintShown;

    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            tick();
            handler.postDelayed(this, TICK_MS);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        script = readAsset("followcheck.js");

        web = new WebView(this);
        web.setBackgroundColor(getColor(R.color.bg));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        // 일반 크롬처럼 보이게 (웹뷰 표시 제거)
        s.setUserAgentString(s.getUserAgentString()
                .replace("; wv", "")
                .replaceAll("Version/\\d+(\\.\\d+)* ", ""));

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new Bridge(), "FCApp");
        web.setWebChromeClient(new WebChromeClient()); // confirm() 대화상자 표시
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                String scheme = u.getScheme() == null ? "" : u.getScheme();
                String host = u.getHost() == null ? "" : u.getHost();
                if (scheme.equals("https") && (host.endsWith("instagram.com") || host.endsWith("facebook.com")
                        || host.endsWith("fbcdn.net") || host.endsWith("accountscenter.instagram.com"))) {
                    return false; // 앱 안에서 계속
                }
                if (scheme.equals("http") || scheme.equals("https")) {
                    openExternal(u);
                }
                return true; // intent://, instagram:// 등은 무시
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                tick();
            }
        });

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl(HOME);
        }
    }

    /** 로그인되어 있고 로그인/보안 확인 화면이 아니면 followcheck 화면을 띄운다. */
    private void tick() {
        if (web == null) return;
        String url = web.getUrl();
        if (url == null) return;
        Uri u = Uri.parse(url);
        String host = u.getHost() == null ? "" : u.getHost();
        if (!host.endsWith("instagram.com")) return;
        String path = u.getPath() == null ? "/" : u.getPath();

        String c = CookieManager.getInstance().getCookie(HOME);
        boolean loggedIn = c != null && c.contains("sessionid=") && c.contains("ds_user_id=");
        boolean authFlow = path.startsWith("/accounts/login") || path.startsWith("/challenge")
                || path.startsWith("/accounts/two_factor") || path.startsWith("/auth_platform")
                || path.startsWith("/accounts/suspended") || path.startsWith("/accounts/password");

        if (!loggedIn) {
            if (!hintShown) {
                hintShown = true;
                Toast.makeText(this, "인스타그램에 로그인하면 바로 맞팔 확인 화면이 열려요", Toast.LENGTH_LONG).show();
            }
            return;
        }
        if (authFlow) return;
        web.evaluateJavascript(HOST_CHECK, v -> {
            if ("false".equals(v)) web.evaluateJavascript(script, null);
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        handler.removeCallbacks(ticker);
        handler.post(ticker);
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacks(ticker);
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript(HOST_CHECK, v -> {
            if ("true".equals(v)) {
                moveTaskToBack(true); // 결과 화면에서는 앱을 닫지 않고 뒤로 보내기
            } else if (web.canGoBack()) {
                web.goBack();
            } else {
                finish();
            }
        });
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
            // 열 앱이 없음
        }
    }

    @SuppressWarnings("deprecation")
    private void setBars(boolean dark) {
        Window w = getWindow();
        int color = dark ? Color.parseColor("#0A0F1A") : Color.parseColor("#F5F7FB");
        w.setStatusBarColor(color);
        w.setNavigationBarColor(color);
        web.setBackgroundColor(color);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(dark ? 0 : mask, mask);
            }
        } else {
            View d = w.getDecorView();
            int flags = d.getSystemUiVisibility();
            int light = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) light |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            d.setSystemUiVisibility(dark ? (flags & ~light) : (flags | light));
        }
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    /** followcheck 화면(JS)에서 부르는 기능 */
    private class Bridge {

        @JavascriptInterface
        public void openProfile(String username) {
            if (username == null || !USERNAME.matcher(username).matches()) return;
            handler.post(() -> {
                Intent app = new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.instagram.com/_u/" + username))
                        .setPackage("com.instagram.android");
                try {
                    startActivity(app);
                } catch (ActivityNotFoundException e) {
                    openExternal(Uri.parse("https://www.instagram.com/" + username + "/"));
                }
            });
        }

        @JavascriptInterface
        public void copy(String text) {
            handler.post(() -> {
                ClipboardManager cb = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                cb.setPrimaryClip(ClipData.newPlainText("followcheck", text));
            });
        }

        @JavascriptInterface
        public void shareFile(String name, String content) {
            handler.post(() -> {
                Intent send = new Intent(Intent.ACTION_SEND)
                        .setType("text/plain")
                        .putExtra(Intent.EXTRA_SUBJECT, name)
                        .putExtra(Intent.EXTRA_TEXT, content);
                startActivity(Intent.createChooser(send, "목록 공유"));
            });
        }

        @JavascriptInterface
        public void setDark(boolean dark) {
            handler.post(() -> setBars(dark));
        }

        @JavascriptInterface
        public void logout() {
            handler.post(() -> {
                CookieManager cm = CookieManager.getInstance();
                cm.removeAllCookies(done -> {
                    cm.flush();
                    hintShown = false;
                    int night = getResources().getConfiguration().uiMode
                            & android.content.res.Configuration.UI_MODE_NIGHT_MASK;
                    setBars(night == android.content.res.Configuration.UI_MODE_NIGHT_YES);
                    web.clearHistory();
                    web.loadUrl(HOME);
                });
            });
        }
    }
}
