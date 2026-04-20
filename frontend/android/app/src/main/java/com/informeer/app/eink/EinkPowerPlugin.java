package com.informeer.app.eink;

import android.content.ComponentName;
import android.content.pm.PackageManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "EinkPower")
public class EinkPowerPlugin extends Plugin {
    private final EinkPowerManager manager = EinkPowerManager.getInstance();

    @Override
    public void load() {
        super.load();
        manager.attachBridge(getBridge());
        manager.attachPlugin(this);
    }

    public void emitHibernateStateChanged() {
        notifyListeners("hibernateStateChanged", manager.toJsObject(), true);
    }

    public void emitWakeCommand(JSObject command, boolean retainUntilConsumed) {
        notifyListeners("wakeCommand", command, retainUntilConsumed);
    }

    @PluginMethod
    public void setPowerState(PluginCall call) {
        manager.setPowerState(
            call.getString("mode", "none"),
            call.getBoolean("eligible", false),
            call.getString("reason", null),
            call.getBoolean("mediaActive", false),
            call.getInt("pendingCriticalWork", 0),
            call.getString("gestureModel", "none")
        );
        call.resolve();
    }

    @PluginMethod
    public void beginCriticalWork(PluginCall call) {
        manager.beginCriticalWork(call.getString("tag", "unknown"));
        call.resolve();
    }

    @PluginMethod
    public void endCriticalWork(PluginCall call) {
        manager.endCriticalWork(call.getString("tag", "unknown"));
        call.resolve();
    }

    @PluginMethod
    public void markVisualStable(PluginCall call) {
        manager.markVisualStable();
        call.resolve();
    }

    @PluginMethod
    public void notifyInteractiveReady(PluginCall call) {
        manager.notifyInteractiveReady();
        call.resolve();
    }

    @PluginMethod
    public void setMediaState(PluginCall call) {
        manager.setMediaState(
            call.getBoolean("audio", false),
            call.getBoolean("video", false),
            call.getBoolean("tts", false)
        );
        call.resolve();
    }

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(manager.toJsObject());
    }

    @PluginMethod
    public void resetStats(PluginCall call) {
        manager.resetStats();
        call.resolve(manager.toJsObject());
    }

    @PluginMethod
    public void setLauncherIcon(PluginCall call) {
        boolean eink = Boolean.TRUE.equals(call.getBoolean("eink", false));
        String pkg = getContext().getPackageName();
        PackageManager pm = getContext().getPackageManager();

        ComponentName defaultAlias = new ComponentName(pkg, pkg + ".MainActivityDefault");
        ComponentName einkAlias = new ComponentName(pkg, pkg + ".MainActivityEink");

        ComponentName enableAlias  = eink ? einkAlias    : defaultAlias;
        ComponentName disableAlias = eink ? defaultAlias : einkAlias;

        pm.setComponentEnabledSetting(
            enableAlias,
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
            PackageManager.DONT_KILL_APP
        );
        pm.setComponentEnabledSetting(
            disableAlias,
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            PackageManager.DONT_KILL_APP
        );

        call.resolve();
    }
}
