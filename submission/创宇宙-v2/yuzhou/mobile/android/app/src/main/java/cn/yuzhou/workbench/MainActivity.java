package cn.chuanzhibei.yuzhou;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.JsResult;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** A private-origin Android client. File access is granted only through Android's picker. */
public final class MainActivity extends Activity {
    // This source copy has no mobile server. Do not inherit the personal host.
    private static final boolean SERVER_CONFIGURED = false;
    private static final String ORIGIN = "https://competition-unconfigured.invalid";
    private static final String HOME = ORIGIN + "/?client=android#/home";
    private static final int PICK_FILE = 41;
    private static final int SAVE_FILE = 42;
    private static final int PURPLE = Color.rgb(121, 80, 242);
    private static final int BACKGROUND = Color.rgb(248, 246, 255);
    private static final long MAX_FILE_BYTES = 256L * 1024 * 1024;
    private static final int MAX_CHUNK_BYTES = 256 * 1024;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService fileWriter = Executors.newSingleThreadExecutor();
    private WebView webView;
    private ProgressBar progress;
    private LinearLayout errorOverlay;
    private TextView errorText;
    private ValueCallback<Uri[]> fileCallback;
    private WebMessagePort downloadPort;
    private Transfer transfer;
    private String pendingSaveId;
    private String bridgeScript;
    private String lastTrustedUrl = HOME;
    private boolean pageFailed;
    private boolean rendererGone;
    private boolean webViewDisposed;
    private boolean bridgeConnecting;
    private int documentGeneration;
    private boolean destroyed;
    private long lastBack;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        buildLayout();
        configureWebView();
        if (!SERVER_CONFIGURED) {
            showFailure("传智杯移动端尚未配置独立服务，请使用比赛目录中的本地网页版。");
            return;
        }
        try { bridgeScript = readAsset("download-bridge.js"); }
        catch (IOException ignored) { bridgeScript = null; }
        if (savedInstanceState != null) {
            String restored = savedInstanceState.getString("lastTrustedUrl", HOME);
            if (isTrusted(restored)) lastTrustedUrl = restored;
            if (webView.restoreState(savedInstanceState) == null || !isTrusted(webView.getUrl())) {
                webView.loadUrl(lastTrustedUrl);
            }
        } else webView.loadUrl(HOME);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
    }

    private void buildLayout() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BACKGROUND);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
                return WindowInsets.CONSUMED;
            });
        } else {
            root.setFitsSystemWindows(true);
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(16), 0, dp(6), 0);
        TextView title = new TextView(this);
        title.setText("传智杯 · 宇宙");
        title.setTextSize(14);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        title.setTextColor(PURPLE);
        toolbar.addView(title, new LinearLayout.LayoutParams(0, -1, 1));
        title.setGravity(Gravity.CENTER_VERTICAL);
        Button menu = new Button(this, null, android.R.attr.borderlessButtonStyle);
        menu.setText("⋮");
        menu.setTextSize(25);
        menu.setTextColor(PURPLE);
        menu.setPadding(0, 0, 0, 0);
        menu.setMinWidth(0);
        menu.setMinimumWidth(0);
        menu.setContentDescription("应用选项");
        menu.setOnClickListener(this::showMenu);
        toolbar.addView(menu, new LinearLayout.LayoutParams(dp(48), dp(44)));
        root.addView(toolbar, new LinearLayout.LayoutParams(-1, dp(44)));
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setProgressTintList(android.content.res.ColorStateList.valueOf(PURPLE));
        root.addView(progress, new LinearLayout.LayoutParams(-1, dp(2)));
        FrameLayout content = new FrameLayout(this);
        webView = new WebView(this);
        webView.setBackgroundColor(BACKGROUND);
        content.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        errorOverlay = new LinearLayout(this);
        errorOverlay.setOrientation(LinearLayout.VERTICAL);
        errorOverlay.setGravity(Gravity.CENTER);
        errorOverlay.setPadding(dp(32), dp(24), dp(32), dp(24));
        errorOverlay.setBackgroundColor(BACKGROUND);
        TextView mark = new TextView(this);
        mark.setText("✦");
        mark.setTextColor(PURPLE);
        mark.setTextSize(50);
        mark.setGravity(Gravity.CENTER);
        errorOverlay.addView(mark);
        TextView titleError = new TextView(this);
        titleError.setText("暂时连接不上宇宙");
        titleError.setTextSize(22);
        titleError.setTextColor(Color.rgb(42, 34, 66));
        titleError.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        titleError.setGravity(Gravity.CENTER);
        errorOverlay.addView(titleError);
        errorText = new TextView(this);
        errorText.setTextSize(15);
        errorText.setGravity(Gravity.CENTER);
        errorText.setPadding(0, dp(16), 0, dp(24));
        errorText.setTextColor(Color.rgb(102, 93, 125));
        errorOverlay.addView(errorText);
        Button retry = new Button(this);
        retry.setText("重新连接");
        retry.setTextColor(Color.WHITE);
        GradientDrawable background = new GradientDrawable();
        background.setColor(PURPLE);
        background.setCornerRadius(dp(16));
        retry.setBackground(background);
        retry.setOnClickListener(view -> reloadTrustedPage());
        errorOverlay.addView(retry, new LinearLayout.LayoutParams(dp(180), dp(50)));
        errorOverlay.setVisibility(View.GONE);
        content.addView(errorOverlay, new FrameLayout.LayoutParams(-1, -1));
        root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        // PhoneWindow needs its decor installed before getInsetsController().
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) controller.setSystemBarsAppearance(
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        }
        root.requestApplyInsets();
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // Only Android-selected content URIs reach file inputs.
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSafeBrowsingEnabled(true);
        settings.setUserAgentString(settings.getUserAgentString() + " YuzhouAndroid/" + BuildConfig.VERSION_NAME);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return !isTrusted(request.getUrl().toString());
                return navigate(request.getUrl().toString());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return navigate(url); }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                documentGeneration++;
                bridgeConnecting = false;
                disconnectDownloads("页面已切换，请重新保存文件");
                pageFailed = false;
                if (!isTrusted(url)) { view.stopLoading(); showFailure("这个地址不能在私人工作台中打开。"); return; }
                lastTrustedUrl = url;
                errorOverlay.setVisibility(View.GONE);
                progress.setVisibility(View.VISIBLE);
            }
            @Override public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.INVISIBLE);
                if (!isTrusted(url) || pageFailed || !url.equals(view.getUrl())) return;
                lastTrustedUrl = url;
                errorOverlay.setVisibility(View.GONE);
                connectDownloads(url);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showFailure("请检查网络后重试。不会自动清除本机资料或登录状态。");
                }
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 400) {
                    showFailure("服务器暂时没有正常回应，请稍后重试。");
                }
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                if (error.getUrl() != null && (error.getUrl().equals(view.getUrl()) || error.getUrl().equals(lastTrustedUrl))) {
                    showFailure("无法验证服务器的安全证书，请检查设备日期或稍后重试。");
                }
            }
            @Override public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                rendererGone = true;
                documentGeneration++;
                bridgeConnecting = false;
                disconnectDownloads("页面已中断，请重新打开后保存文件");
                if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
                disposeWebView();
                showFailure("页面进程已被系统回收，请重新打开。已保存的资料仍会保留。");
                new AlertDialog.Builder(MainActivity.this).setTitle("页面需要重新打开")
                    .setMessage("系统回收了页面进程。重新打开会恢复登录和本机已保存的资料；未保存的输入可能需要重新填写。")
                    .setPositiveButton("重新打开", (dialog, which) -> recreate()).setCancelable(false).show();
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) {
                progress.setProgress(value);
                if (value == 100) progress.setVisibility(View.INVISIBLE);
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (!isTrusted(view.getUrl())) { callback.onReceiveValue(null); return true; }
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                ArrayList<String> types = new ArrayList<>();
                for (String accept : params.getAcceptTypes()) {
                    if (accept == null) continue;
                    for (String token : accept.split(",")) {
                        token = token.trim();
                        if (token.matches("[A-Za-z0-9!#$&^_.+*-]+/[A-Za-z0-9!#$&^_.+*-]+")) types.add(token);
                    }
                }
                if (!types.isEmpty()) intent.putExtra(Intent.EXTRA_MIME_TYPES, types.toArray(new String[0]));
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try { startActivityForResult(intent, PICK_FILE); }
                catch (ActivityNotFoundException ignored) { fileCallback.onReceiveValue(null); fileCallback = null; toast("没有可用的文件选择器"); }
                return true;
            }
            @Override public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                if (!isTrusted(url)) { result.cancel(); return true; }
                new AlertDialog.Builder(MainActivity.this).setTitle("宇宙").setMessage(message)
                    .setPositiveButton("知道了", (dialog, which) -> result.confirm())
                    .setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }
            @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                if (!isTrusted(url)) { result.cancel(); return true; }
                new AlertDialog.Builder(MainActivity.this).setTitle("宇宙").setMessage(message)
                    .setPositiveButton("确定", (dialog, which) -> result.confirm())
                    .setNegativeButton("取消", (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }
            @Override public boolean onJsBeforeUnload(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setTitle("还有内容正在同步")
                    .setMessage("离开或刷新可能中断同步。你可以留在当前页面，等同步完成后再操作。")
                    .setPositiveButton("继续离开", (dialog, which) -> result.confirm())
                    .setNegativeButton("留在这里", (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }
        });
        webView.setDownloadListener((url, userAgent, disposition, mime, length) -> {
            if (!isTrusted(webView.getUrl())) return;
            if (downloadPort == null) { toast("文件保存组件尚未就绪，请稍后再试"); return; }
            String script = "window.YuzhouDownloads&&window.YuzhouDownloads.downloadUrl(" + JSONObject.quote(url) + ",null," + JSONObject.quote(mime == null ? "application/octet-stream" : mime) + ")";
            webView.evaluateJavascript(script, null);
        });
    }

    private boolean navigate(String url) {
        if (isTrusted(url)) return false;
        Uri uri = Uri.parse(url);
        if ("https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null && uri.getUserInfo() == null) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)); }
            catch (ActivityNotFoundException ignored) { toast("没有可打开此链接的浏览器"); }
        } else toast("此链接不能在工作台中打开");
        return true;
    }

    private static boolean isTrusted(String url) {
        if (!SERVER_CONFIGURED || url == null) return false;
        try {
            Uri uri = Uri.parse(url);
            return "https".equalsIgnoreCase(uri.getScheme()) && Uri.parse(ORIGIN).getHost().equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null;
        } catch (RuntimeException ignored) { return false; }
    }

    private void showMenu(View anchor) {
        PopupMenu menu = new PopupMenu(this, anchor);
        menu.getMenu().add(0, 1, 0, "返回空间主页");
        menu.getMenu().add(0, 2, 1, "检查界面更新");
        menu.getMenu().add(0, 3, 2, "关于宇宙");
        menu.setOnMenuItemClickListener(item -> {
            if (item.getItemId() == 1) {
                if (!rendererGone && !pageFailed && isTrusted(webView.getUrl())) webView.evaluateJavascript("location.hash='/home'", null);
                else confirmReload();
            } else if (item.getItemId() == 2) confirmReload();
            else new AlertDialog.Builder(this).setTitle("传智杯 · 宇宙 · " + BuildConfig.VERSION_NAME)
                .setMessage("手机与平板共用你的私人工作台。\n\n登录同一账号即可同步资料。界面功能由服务器更新，重新打开或检查界面更新即可加载。\n\n文件通过系统选择器导入和保存。应用不读取通讯录、短信、微信或 QQ 消息。\n\n需要网络连接；没有后台推送通知。")
                .setPositiveButton("知道了", null).show();
            return true;
        });
        menu.show();
    }

    private void confirmReload() {
        if (!SERVER_CONFIGURED) { reloadTrustedPage(); return; }
        new AlertDialog.Builder(this).setTitle("加载最新界面？")
            .setMessage("请先保存正在编辑的内容，并等待同步完成。刷新后会从服务器加载最新界面。")
            .setPositiveButton("刷新", (dialog, which) -> reloadTrustedPage())
            .setNegativeButton("取消", null).show();
    }

    private void reloadTrustedPage() {
        if (!SERVER_CONFIGURED) {
            showFailure("传智杯移动端尚未配置独立服务，请使用比赛目录中的本地网页版。");
            return;
        }
        if (rendererGone) recreate();
        else if (isTrusted(lastTrustedUrl)) webView.loadUrl(lastTrustedUrl);
    }

    @Override public void onBackPressed() { handleBack(); }

    private void handleBack() {
        if (destroyed || rendererGone) { backgroundApp(); return; }
        if (!isTrusted(webView.getUrl()) || pageFailed) { backgroundApp(); return; }
        String dismiss = "(()=>{const d=document.querySelector('dialog[open]');if(d){const b=d.querySelector('[data-close]');b?b.click():d.close();return true;}const a=document.querySelector('#ai-drawer');if(document.body.classList.contains('rail-open')||(a&&!a.hidden)){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true;}return false;})()";
        webView.evaluateJavascript(dismiss, result -> {
            if (destroyed || "true".equals(result)) return;
            Uri current = Uri.parse(webView.getUrl() == null ? HOME : webView.getUrl());
            String fragment = current.getFragment();
            if (fragment != null && !fragment.isEmpty() && !"/home".equals(fragment)) {
                if (webView.canGoBack()) webView.goBack();
                else webView.evaluateJavascript("location.hash='/home'", null);
            } else backgroundApp();
        });
    }

    private void backgroundApp() {
        long now = SystemClock.elapsedRealtime();
        if (now - lastBack < 2000) { moveTaskToBack(true); lastBack = 0; }
        else { lastBack = now; toast("再按一次收起宇宙"); }
    }

    private void showFailure(String message) {
        pageFailed = true;
        progress.setVisibility(View.INVISIBLE);
        errorText.setText(message);
        errorOverlay.setVisibility(View.VISIBLE);
    }

    private void connectDownloads(String url) {
        if (bridgeScript == null || destroyed || bridgeConnecting) return;
        bridgeConnecting = true;
        final int generation = documentGeneration;
        webView.evaluateJavascript("Boolean(window.__yuzhouDownloads&&window.__yuzhouDownloads.ready)", ready -> {
            if (destroyed || generation != documentGeneration) return;
            if (pageFailed || !isTrusted(webView.getUrl())) { bridgeConnecting = false; return; }
            if (downloadPort != null && "true".equals(ready)) { bridgeConnecting = false; return; }
            disconnectDownloads("文件保存连接已更新，请重试");
            webView.evaluateJavascript(bridgeScript, ignored -> {
                if (destroyed || generation != documentGeneration) return;
                bridgeConnecting = false;
                if (pageFailed || !isTrusted(webView.getUrl()) || downloadPort != null) return;
                WebMessagePort[] ports = webView.createWebMessageChannel();
                downloadPort = ports[0];
                downloadPort.setWebMessageCallback(new WebMessagePort.WebMessageCallback() {
                    @Override public void onMessage(WebMessagePort port, WebMessage message) {
                        if (port == downloadPort && isTrusted(webView.getUrl())) receiveDownload(message.getData());
                    }
                }, main);
                webView.postWebMessage(new WebMessage("yuzhou-download-port-v1", new WebMessagePort[]{ports[1]}), Uri.parse(ORIGIN));
            });
        });
    }

    private void receiveDownload(String text) {
        if (text == null || text.length() > 360000) return;
        String id = "";
        try {
            JSONObject message = new JSONObject(text);
            id = message.optString("id", "");
            if (!id.matches("[A-Za-z0-9_-]{1,96}")) return;
            String type = message.optString("type", "");
            if ("begin".equals(type)) {
                if (transfer != null || pendingSaveId != null) { sendError(id, "请先完成当前文件的保存"); return; }
                Object rawSize = message.opt("size");
                if (!(rawSize instanceof Number)) throw new IOException("无法识别文件大小");
                double size = ((Number) rawSize).doubleValue();
                if (size < 0 || size > MAX_FILE_BYTES || size != Math.floor(size)) throw new IOException("单个文件最大支持 256 MB");
                String name = safeFileName(message.optString("name", "宇宙文件"));
                String mime = message.optString("mime", "application/octet-stream");
                if (!mime.matches("[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+")) mime = "application/octet-stream";
                transfer = new Transfer(id, (long) size);
                pendingSaveId = id;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(mime).putExtra(Intent.EXTRA_TITLE, name);
                try { startActivityForResult(intent, SAVE_FILE); }
                catch (ActivityNotFoundException ignored) { pendingSaveId = null; failTransfer(transfer, "没有可用的文件保存位置"); }
                return;
            }
            Transfer current = transfer;
            if (current == null || !current.id.equals(id)) { sendError(id, "文件保存已结束，请重新开始"); return; }
            if ("cancel".equals(type)) { failTransfer(current, "已取消保存"); return; }
            if (current.stream == null || current.busy) throw new IOException("文件尚未准备好");
            if ("chunk".equals(type)) {
                Object rawSequence = message.opt("sequence");
                if (!(rawSequence instanceof Number) || ((Number) rawSequence).doubleValue() != current.sequence) throw new IOException("文件分段顺序有误");
                String encoded = message.getString("data");
                if (encoded.length() > ((MAX_CHUNK_BYTES + 2) / 3) * 4 + 4 || !encoded.matches("[A-Za-z0-9+/]*={0,2}")) throw new IOException("文件分段过大或格式有误");
                final int sequence = current.sequence;
                current.busy = true;
                fileWriter.execute(() -> {
                    try {
                        byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
                        if (bytes.length == 0 || bytes.length > MAX_CHUNK_BYTES || current.written + bytes.length > current.size) throw new IOException("文件长度不匹配");
                        if (current.cancelled) return;
                        current.stream.write(bytes);
                        current.written += bytes.length;
                        main.post(() -> {
                            if (current != transfer || current.cancelled) return;
                            current.sequence++;
                            current.busy = false;
                            sendMessage("ack", current.id, sequence, null);
                        });
                    } catch (Exception ignored) { main.post(() -> failTransfer(current, "文件写入失败，请检查剩余空间后重试")); }
                });
            } else if ("end".equals(type)) {
                if (current.written != current.size) throw new IOException("文件长度不匹配，请重新保存");
                current.busy = true;
                fileWriter.execute(() -> {
                    try {
                        if (current.cancelled) return;
                        current.stream.flush();
                        current.stream.close();
                        main.post(() -> {
                            if (transfer != current || current.cancelled) return;
                            transfer = null;
                            sendMessage("complete", current.id, -1, null);
                            toast("文件已保存到你选择的位置");
                        });
                    } catch (Exception ignored) { main.post(() -> failTransfer(current, "文件保存未完成，请重试")); }
                });
            } else throw new IOException("无法识别文件保存请求");
        } catch (Exception error) {
            String safeMessage = error instanceof IOException ? error.getMessage() : "文件保存请求格式有误";
            if (transfer != null && transfer.id.equals(id)) failTransfer(transfer, safeMessage);
            else if (!id.isEmpty()) sendError(id, safeMessage);
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_FILE) {
            ValueCallback<Uri[]> callback = fileCallback;
            fileCallback = null;
            if (callback == null) return;
            Set<Uri> selected = new LinkedHashSet<>();
            if (resultCode == RESULT_OK && data != null && !rendererGone && isTrusted(webView.getUrl())) {
                if (isContentUri(data.getData())) selected.add(data.getData());
                ClipData clips = data.getClipData();
                if (clips != null) for (int index = 0; index < Math.min(clips.getItemCount(), 64); index++) {
                    Uri uri = clips.getItemAt(index).getUri();
                    if (isContentUri(uri)) selected.add(uri);
                }
            }
            callback.onReceiveValue(selected.isEmpty() ? null : selected.toArray(new Uri[0]));
        } else if (requestCode == SAVE_FILE) {
            String requestedId = pendingSaveId;
            pendingSaveId = null;
            Transfer current = transfer;
            if (current == null || !current.id.equals(requestedId)) return;
            Uri destination = data == null ? null : data.getData();
            if (resultCode != RESULT_OK || !isContentUri(destination)) { failTransfer(current, "已取消保存"); return; }
            current.uri = destination;
            current.busy = true;
            fileWriter.execute(() -> {
                try {
                    if (current.cancelled) return;
                    current.stream = getContentResolver().openOutputStream(destination, "w");
                    if (current.stream == null) throw new IOException("No stream");
                    main.post(() -> {
                        if (transfer != current || current.cancelled) return;
                        current.busy = false;
                        sendMessage("ready", current.id, -1, null);
                    });
                } catch (Exception ignored) { main.post(() -> failTransfer(current, "无法写入所选位置，请选择其他文件夹")); }
            });
        }
    }

    private static boolean isContentUri(Uri uri) {
        if (uri == null || !"content".equals(uri.getScheme()) || uri.getAuthority() == null || uri.getAuthority().isEmpty()) return false;
        String authority = uri.getAuthority();
        return !authority.equals("cn.chuanzhibei.yuzhou") && !authority.startsWith("cn.chuanzhibei.yuzhou.");
    }

    private static String safeFileName(String name) {
        String result = name.replaceAll("[\\\\/\\p{Cntrl}:*?\"<>|]", "_").trim();
        while (result.startsWith(".")) result = result.substring(1);
        if (result.isEmpty()) result = "宇宙文件";
        return result.length() > 160 ? result.substring(0, 160) : result;
    }

    private void sendMessage(String type, String id, int sequence, String message) {
        if (destroyed || rendererGone || downloadPort == null || !isTrusted(webView.getUrl())) return;
        try {
            JSONObject payload = new JSONObject().put("type", type).put("id", id);
            if (sequence >= 0) payload.put("sequence", sequence);
            if (message != null) payload.put("message", message);
            downloadPort.postMessage(new WebMessage(payload.toString()));
        } catch (JSONException | IllegalStateException ignored) { /* A navigation can close the port. */ }
    }

    private void sendError(String id, String message) { sendMessage("error", id, -1, message); }

    private void failTransfer(Transfer current, String message) {
        if (current == null || current.cancelled) return;
        current.cancelled = true;
        if (transfer == current) {
            transfer = null;
            sendError(current.id, current.uri == null ? message : message + "；所选位置可能留下未完成的文件");
        }
        fileWriter.execute(() -> {
            if (current.stream != null) try { current.stream.close(); } catch (IOException ignored) { }
            // A failed export may leave a partial file. Never delete user-selected documents.
        });
    }

    private void disconnectDownloads(String reason) {
        if (transfer != null) failTransfer(transfer, reason);
        if (downloadPort != null) {
            try { downloadPort.close(); } catch (IllegalStateException ignored) { }
            downloadPort = null;
        }
    }

    private String readAsset(String name) throws IOException {
        try (InputStream input = getAssets().open(name); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[8192];
            int size;
            while ((size = input.read(chunk)) != -1) {
                if (bytes.size() + size > 256 * 1024) throw new IOException("Bridge exceeds asset limit");
                bytes.write(chunk, 0, size);
            }
            return new String(bytes.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    @Override protected void onSaveInstanceState(Bundle outState) {
        if (!rendererGone) webView.saveState(outState);
        outState.putString("lastTrustedUrl", lastTrustedUrl);
        super.onSaveInstanceState(outState);
    }

    @Override protected void onPause() {
        CookieManager.getInstance().flush();
        super.onPause(); // Keep the current document and its pending synchronization alive.
    }

    @Override protected void onDestroy() {
        disconnectDownloads("应用已关闭，请重新保存文件");
        destroyed = true;
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        disposeWebView();
        fileWriter.shutdown();
        super.onDestroy();
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void toast(String text) { if (!destroyed) Toast.makeText(this, text, Toast.LENGTH_SHORT).show(); }

    private void disposeWebView() {
        if (webViewDisposed) return;
        webViewDisposed = true;
        if (!rendererGone) {
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(new WebViewClient());
        }
        if (webView.getParent() instanceof ViewGroup) ((ViewGroup) webView.getParent()).removeView(webView);
        webView.destroy();
    }

    private static final class Transfer {
        final String id;
        final long size;
        long written;
        int sequence;
        boolean busy;
        volatile boolean cancelled;
        Uri uri;
        OutputStream stream;
        Transfer(String id, long size) { this.id = id; this.size = size; }
    }
}
