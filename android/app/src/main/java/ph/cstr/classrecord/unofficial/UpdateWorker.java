package ph.cstr.classrecord.unofficial;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.*;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.work.*;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

public class UpdateWorker extends Worker {
    private static final String FEED="https://jonmiru69.github.io/CSTRClassRecordUnofficial/downloads/latest.json";
    public UpdateWorker(@NonNull Context context,@NonNull WorkerParameters parameters){super(context,parameters);}
    public static void schedule(Context context){
        if(!context.getSharedPreferences("cstr-update-preferences",0).getBoolean("enabled",false))return;
        Constraints constraints=new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest request=new PeriodicWorkRequest.Builder(UpdateWorker.class,15,TimeUnit.MINUTES).setConstraints(constraints).build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("cstr-release-check",ExistingPeriodicWorkPolicy.KEEP,request);
    }
    @SuppressWarnings("deprecation") static PackageInfo installed(Context context) throws Exception {
        return context.getPackageManager().getPackageInfo(context.getPackageName(),Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES);
    }
    @SuppressWarnings("deprecation") static long version(Context context) throws Exception {
        PackageInfo info=installed(context);return Build.VERSION.SDK_INT>=28?info.getLongVersionCode():info.versionCode;
    }
    private static boolean whole(JSONObject value,String name,long minimum,long maximum){
        Object raw=value.opt(name);if(!(raw instanceof Number))return false;
        double number=((Number)raw).doubleValue();return !Double.isNaN(number)&&!Double.isInfinite(number)&&number==Math.rint(number)&&number>=minimum&&number<=maximum;
    }
    @SuppressWarnings("deprecation") public static boolean validRelease(Context context,JSONObject release) throws Exception {
        if(!whole(release,"schemaVersion",1,1)||!Boolean.TRUE.equals(release.opt("available"))||!context.getPackageName().equals(release.optString("appId"))||!whole(release,"versionCode",1,2147483647))return false;
        if(!release.optString("version").matches("\\d+\\.\\d+\\.\\d+")||!release.optString("sha256").matches("[A-Fa-f0-9]{64}"))return false;
        if(!whole(release,"bytes",1,150L*1024*1024))return false;
        if(!whole(release,"minimumSupportedVersionCode",0,release.optLong("versionCode")))return false;
        long minimum=release.optLong("minimumSupportedVersionCode",-1);if(minimum<0||minimum>release.optLong("versionCode"))return false;
        URI uri=new URI(release.getString("url"));
        if(!"https".equals(uri.getScheme())||!"jonmiru69.github.io".equals(uri.getHost())||uri.getPort()!=-1||uri.getUserInfo()!=null||uri.getQuery()!=null||uri.getFragment()!=null||!uri.getPath().matches("/CSTRClassRecordUnofficial/downloads/CSTR-Class-Record-\\d+\\.\\d+\\.\\d+\\.apk"))return false;
        if(!uri.getPath().endsWith("/CSTR-Class-Record-"+release.getString("version")+".apk"))return false;
        PackageInfo info=installed(context);
        Signature[] signatures=Build.VERSION.SDK_INT>=28?info.signingInfo.getApkContentsSigners():info.signatures;
        for(Signature signature:signatures){
            byte[] digest=MessageDigest.getInstance("SHA-256").digest(signature.toByteArray());StringBuilder hex=new StringBuilder();for(byte item:digest)hex.append(String.format("%02x",item&0xff));
            if(hex.toString().equalsIgnoreCase(release.optString("certificateSha256")))return true;
        }
        return false;
    }
    @NonNull @Override public Result doWork(){
        Context context=getApplicationContext();HttpURLConnection connection=null;
        try{
            if(!context.getSharedPreferences("cstr-update-preferences",0).getBoolean("enabled",false))return Result.success();
            connection=(HttpURLConnection)new URL(FEED).openConnection();connection.setConnectTimeout(15000);connection.setReadTimeout(15000);connection.setUseCaches(false);connection.setInstanceFollowRedirects(false);
            if(connection.getResponseCode()!=200)return Result.retry();
            ByteArrayOutputStream output=new ByteArrayOutputStream();try(InputStream input=connection.getInputStream()){
                byte[] buffer=new byte[4096];int count;while((count=input.read(buffer))!=-1){output.write(buffer,0,count);if(output.size()>65536)return Result.failure();}
            }
            JSONObject release=new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
            if(!validRelease(context,release)||release.getLong("versionCode")<=version(context))return Result.success();
            if(Build.VERSION.SDK_INT>=33&&ContextCompat.checkSelfPermission(context,Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return Result.success();
            SharedPreferences prefs=context.getSharedPreferences("cstr-update-preferences",0);
            if(prefs.getLong("lastVersion",0)==release.getLong("versionCode")&&System.currentTimeMillis()-prefs.getLong("lastNotice",0)<86400000)return Result.success();
            NotificationManager manager=(NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE);
            if(Build.VERSION.SDK_INT>=26)manager.createNotificationChannel(new NotificationChannel("app-updates","App updates",NotificationManager.IMPORTANCE_DEFAULT));
            Intent intent=new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent action=PendingIntent.getActivity(context,2461,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            String versionLabel = release.getString("version");
            String notes = release.optString("notes", "").trim();
            if (notes.length() > 500) notes = notes.substring(0, 500).trim() + "…";
            String reminder = "Save your work before updating.";
            String expanded = notes.isEmpty() ? reminder : notes + "\n\n" + reminder;
            manager.notify(2461, new NotificationCompat.Builder(context, "app-updates")
                .setSmallIcon(R.drawable.ic_update)
                .setContentTitle("CST-R " + versionLabel + " is ready")
                .setContentText(notes.isEmpty() ? reminder : notes)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(expanded))
                .setContentIntent(action).setAutoCancel(true).build());
            prefs.edit().putLong("lastVersion",release.getLong("versionCode")).putLong("lastNotice",System.currentTimeMillis()).apply();return Result.success();
        }catch(Exception error){return Result.retry();}finally{if(connection!=null)connection.disconnect();}
    }
}
