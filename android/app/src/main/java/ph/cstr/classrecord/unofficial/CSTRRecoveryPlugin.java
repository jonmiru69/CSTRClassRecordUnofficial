package ph.cstr.classrecord.unofficial;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

@CapacitorPlugin(name="CSTRRecovery")
public class CSTRRecoveryPlugin extends Plugin {
    private static final String ALIAS="cstr-device-recovery-v1";
    private AtomicFile file(){return new AtomicFile(new File(getContext().getNoBackupFilesDir(),"cstr-recovery.enc"));}
    private SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(store.containsAlias(ALIAS))return (SecretKey)store.getKey(ALIAS,null);
        KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
        return generator.generateKey();
    }
    @PluginMethod public synchronized void read(PluginCall call){
        try{
            if(!file().getBaseFile().exists()){call.resolve(new JSObject().put("data",""));return;}
            JSONObject saved=new JSONObject(new String(file().readFully(),StandardCharsets.UTF_8));
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(saved.getString("iv"),Base64.NO_WRAP)));
            String data=new String(cipher.doFinal(Base64.decode(saved.getString("ciphertext"),Base64.NO_WRAP)),StandardCharsets.UTF_8);
            call.resolve(new JSObject().put("data",data));
        }catch(Exception error){call.reject("Encrypted recovery could not be opened. Cloud records are unaffected.");}
    }
    @PluginMethod public synchronized void write(PluginCall call){
        String data=call.getString("data");if(data==null||data.length()>25000000){call.reject("Recovery data exceeds the device limit.");return;}
        FileOutputStream stream=null;AtomicFile target=file();
        try{
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
            JSONObject saved=new JSONObject().put("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)).put("ciphertext",Base64.encodeToString(cipher.doFinal(data.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP));
            stream=target.startWrite();stream.write(saved.toString().getBytes(StandardCharsets.UTF_8));target.finishWrite(stream);call.resolve();
        }catch(Exception error){if(stream!=null)target.failWrite(stream);call.reject("Encrypted recovery could not be saved.");}
    }
    @PluginMethod public synchronized void clear(PluginCall call){file().delete();if(file().getBaseFile().exists())call.reject("Could not clear device recovery.");else call.resolve();}
}
