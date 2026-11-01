package ph.cstr.classrecord.unofficial;

import android.Manifest;
import android.os.Build;
import android.content.Intent;
import android.net.Uri;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name="CSTRUpdates",permissions={@Permission(alias="notifications",strings={Manifest.permission.POST_NOTIFICATIONS})})
public class CSTRUpdatesPlugin extends Plugin {
    @PluginMethod public void openSupport(PluginCall call){
        try{getActivity().startActivity(new Intent(Intent.ACTION_SENDTO,Uri.parse("mailto:SANCHEZRAMIL2202@GMAIL.COM")));call.resolve();}
        catch(Exception error){call.reject("No email app is available. Contact SANCHEZRAMIL2202@GMAIL.COM from your email service.");}
    }
    @PluginMethod public void verifyRelease(PluginCall call){
        try{call.resolve(new JSObject().put("valid",UpdateWorker.validRelease(getContext(),call.getData())));}
        catch(Exception error){call.reject("Could not verify update signing identity.");}
    }
    @PluginMethod public void enableAlerts(PluginCall call){
        if(Build.VERSION.SDK_INT>=33 && getPermissionState("notifications")!=PermissionState.GRANTED){requestPermissionForAlias("notifications",call,"alertsPermission");return;}
        completeAlerts(call);
    }
    @PermissionCallback private void alertsPermission(PluginCall call){completeAlerts(call);}
    private void completeAlerts(PluginCall call){
        boolean granted=NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
        getContext().getSharedPreferences("cstr-update-preferences",0).edit().putBoolean("enabled",granted).apply();
        if(granted)UpdateWorker.schedule(getContext());
        call.resolve(new JSObject().put("granted",granted));
    }
}
