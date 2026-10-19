package cn.chuanzhibei.yuzhou.smoke;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.Bundle;
import android.os.SystemClock;
import android.webkit.WebSettings;
import android.webkit.WebView;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Emulator-only instrumentation; does not inspect accounts, cookies or credentials. */
public final class NativeSmoke extends Instrumentation {
    private static final boolean COMPETITION_SMOKE_ENABLED = false;
    private static final String ORIGIN = "https://competition-unconfigured.invalid";
    private WebView webView;
    private Activity activity;

    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); start(); }

    @Override public void onStart() {
        Bundle result = new Bundle();
        if (!COMPETITION_SMOKE_ENABLED) {
            result.putString("result", "DISABLED: competition mobile environment is not configured");
            finish(Activity.RESULT_CANCELED, result);
            return;
        }
        try {
            Intent launch = new Intent(Intent.ACTION_MAIN)
                .setClassName("cn.chuanzhibei.yuzhou", "cn.chuanzhibei.yuzhou.MainActivity")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity = startActivitySync(launch);
            Field field = activity.getClass().getDeclaredField("webView");
            field.setAccessible(true);
            webView = (WebView) field.get(activity);
            boolean[] secure = new boolean[1];
            runOnMainSync(() -> {
                WebSettings settings = webView.getSettings();
                secure[0] = settings.getJavaScriptEnabled() && settings.getDomStorageEnabled()
                    && !settings.getAllowFileAccess() && !settings.getAllowFileAccessFromFileURLs()
                    && !settings.getAllowUniversalAccessFromFileURLs()
                    && settings.getMixedContentMode() == WebSettings.MIXED_CONTENT_NEVER_ALLOW;
                webView.stopLoading();
                webView.loadDataWithBaseURL(ORIGIN + "/native-smoke", fixture(), "text/html", "UTF-8", ORIGIN + "/native-smoke");
            });
            require(secure[0], "WebView secure settings failed");
            Method trusted = activity.getClass().getDeclaredMethod("isTrusted", String.class);
            trusted.setAccessible(true);
            require(Boolean.TRUE.equals(trusted.invoke(activity, ORIGIN + "/#/home")), "Trusted origin rejected");
            for (String url : new String[]{"http://competition-unconfigured.invalid/", "https://competition-unconfigured.invalid.evil.example/", "file:///sdcard/test", "https://example.com/"})
                require(Boolean.FALSE.equals(trusted.invoke(activity, url)), "Foreign origin accepted");
            await("Boolean(window.__yuzhouDownloads&&window.__yuzhouDownloads.ready)", 20000);
            eval("location.hash='/native-test';true");
            await("Boolean(window.__yuzhouDownloads&&window.__yuzhouDownloads.ready)", 10000);
            eval("document.getElementById('test-modal').showModal();true");
            await("document.getElementById('test-modal').open", 5000);
            runOnMainSync(() -> activity.onBackPressed());
            await("!document.getElementById('test-modal').open", 5000);
            eval("document.getElementById('result').textContent='原生连接、来源校验与返回键通过；请导出、导入并旋转屏幕。';true");
            Bundle ready = new Bundle();
            ready.putString("stream", "fixture-ready\n点击导出测试文件，保存后导入同一文件，并旋转或调整设备尺寸。\n");
            ready.putString("status", "fixture-ready");
            sendStatus(1, ready);
            long deadline = SystemClock.elapsedRealtime() + 300000;
            boolean complete = false;
            while (SystemClock.elapsedRealtime() < deadline) {
                require("true".equals(eval("document.getElementById('draft').value===window.testDraft")), "Draft changed during rotation/SAF");
                if ("true".equals(eval("window.testExported===true&&window.testImported===true&&window.testResizeCount>0"))) { complete = true; break; }
                SystemClock.sleep(700);
            }
            require(complete, "Timed out: export/import and a viewport resize are required. " + eval("JSON.stringify({exported:window.testExported,imported:window.testImported,resizes:window.testResizeCount})"));
            String metrics = eval("JSON.stringify({exported:window.testExported,imported:window.testImported,resizes:window.testResizeCount,initial:window.testInitialViewport,final:[innerWidth,innerHeight],draftPreserved:document.getElementById('draft').value===window.testDraft})");
            result.putString("stream", "PASS: native settings, origin boundary, message port, hash navigation, modal Back, SAF export/import, draft preservation.\n" + metrics + "\n");
            result.putString("result", "PASS");
            finish(Activity.RESULT_OK, result);
        } catch (Throwable error) {
            result.putString("stream", "FAIL: " + android.util.Log.getStackTraceString(error));
            result.putString("result", "FAIL");
            finish(Activity.RESULT_CANCELED, result);
        }
    }

    private String eval(String javascript) throws Exception {
        AtomicReference<String> value = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        runOnMainSync(() -> webView.evaluateJavascript(javascript, answer -> { value.set(answer); done.countDown(); }));
        require(done.await(15, TimeUnit.SECONDS), "JavaScript callback timed out");
        return value.get();
    }

    private void await(String expression, long milliseconds) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + milliseconds;
        do {
            if ("true".equals(eval(expression))) return;
            SystemClock.sleep(150);
        } while (SystemClock.elapsedRealtime() < deadline);
        throw new AssertionError("Condition timed out: " + expression);
    }

    private static void require(boolean condition, String message) { if (!condition) throw new AssertionError(message); }

    private static String fixture() {
        return "<!doctype html><html lang='zh-CN'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
            + "<style>body{font:17px sans-serif;background:#f6f2ff;color:#27203c;padding:18px;margin:0}main{max-width:650px;margin:auto}h1{font-size:25px}button,input,textarea{box-sizing:border-box;width:100%;font:17px sans-serif;margin:12px 0;padding:15px;border:1px solid #9c77ef;border-radius:12px}button{background:#7950f2;color:white;min-height:58px}textarea{height:100px;background:white}output{display:block;background:#e3ffe9;padding:14px;line-height:1.5;border-radius:12px}dialog{border:2px solid #7950f2;border-radius:16px;padding:25px}</style>"
            + "<main><h1>宇宙 · 原生文件测试</h1><p>仅使用这台模拟器的测试文件，不连接个人数据。</p>"
            + "<label for='draft'>旋转屏幕时保留的草稿</label><textarea id='draft'></textarea>"
            + "<button id='export'>导出测试文件</button><label for='upload'>导入刚才保存的测试文件</label><input type='file' id='upload' accept='text/plain'>"
            + "<output id='result'>正在检查原生连接…</output><dialog id='test-modal'>返回键关闭测试</dialog></main>"
            + "<script>window.testPayload='Yuzhou native file roundtrip\\n中文与0.30元';window.testDraft='草稿保留测试：宇宙 0.30 元';document.getElementById('draft').value=window.testDraft;"
            + "window.testExported=false;window.testImported=false;window.testResizeCount=0;window.testInitialViewport=[innerWidth,innerHeight];addEventListener('resize',()=>{window.testResizeCount++;});"
            + "document.getElementById('export').onclick=async()=>{const url=URL.createObjectURL(new Blob([window.testPayload],{type:'text/plain'}));try{window.testExported=await window.__yuzhouDownloads.downloadUrl(url,'yuzhou-native-smoke.txt','text/plain');document.getElementById('result').textContent=window.testExported?'导出成功，请导入同一文件。':'尚未保存，请重试。';}catch(e){document.getElementById('result').textContent='导出失败：'+e.message;}finally{URL.revokeObjectURL(url);}};"
            + "document.getElementById('upload').onchange=async event=>{const file=event.target.files[0];if(!file)return;window.testImported=(await file.text())===window.testPayload;document.getElementById('result').textContent=window.testImported?'文件内容完全一致，请旋转屏幕完成检查。':'文件内容不匹配，请选择刚刚导出的文件。';};</script></html>";
    }
}
