package com.zhixunyun.traffic;

import android.graphics.Color;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private int statusBarInset;
    private int navigationBarInset;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = getBridge().getWebView();
        webView.addJavascriptInterface(new SystemBarBridge(), "AppSystemBar");
        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> {
            Insets status = insets.getInsets(WindowInsetsCompat.Type.statusBars());
            Insets navigation = insets.getInsets(WindowInsetsCompat.Type.navigationBars());
            Insets gestures = insets.getInsets(WindowInsetsCompat.Type.mandatorySystemGestures());
            statusBarInset = status.top;
            // Gesture navigation can report a zero navigation-bar inset while
            // still reserving a bottom gesture area. Keep the larger value so
            // the app's bottom navigation never sits under the system handle.
            navigationBarInset = Math.max(navigation.bottom, gestures.bottom);
            syncInsetsToWebView(webView);
            return insets;
        });
        ViewCompat.requestApplyInsets(webView);
        showLoginSystemBar();
    }

    private void syncInsetsToWebView(WebView webView) {
        webView.post(() -> webView.evaluateJavascript(
            "document.documentElement.style.setProperty('--native-status-bar-inset','" + statusBarInset
                + "px');document.documentElement.style.setProperty('--native-navigation-bar-inset','"
                + navigationBarInset + "px');", null));
    }

    private void showLoginSystemBar() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        getWindow().getDecorView().setBackgroundColor(Color.rgb(17, 36, 62));
        WindowInsetsControllerCompat systemBars = WindowCompat.getInsetsController(
            getWindow(),
            getWindow().getDecorView()
        );
        systemBars.setAppearanceLightStatusBars(false);
        systemBars.setAppearanceLightNavigationBars(false);
    }

    private void showAppSystemBar() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().getDecorView().setBackgroundColor(Color.WHITE);
        WindowInsetsControllerCompat systemBars = WindowCompat.getInsetsController(
            getWindow(),
            getWindow().getDecorView()
        );
        systemBars.setAppearanceLightStatusBars(true);
    }

    private class SystemBarBridge {
        @JavascriptInterface
        public String getInsets() {
            return statusBarInset + "," + navigationBarInset;
        }

        @JavascriptInterface
        public void setMode(String mode) {
            runOnUiThread(() -> {
                if ("app".equals(mode)) showAppSystemBar();
                else showLoginSystemBar();
            });
        }
    }
}
