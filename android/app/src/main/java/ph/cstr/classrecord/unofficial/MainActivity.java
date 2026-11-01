package ph.cstr.classrecord.unofficial;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.view.View;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.graphics.Insets;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState){
        registerPlugin(CSTRRecoveryPlugin.class);registerPlugin(CSTRUpdatesPlugin.class);
        super.onCreate(savedInstanceState);
        // Native container owns system + IME insets exactly once. Web content owns app navigation clearance.
        View root=findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(root,(view,insets)->{
            Insets system=insets.getInsets(WindowInsetsCompat.Type.systemBars()|WindowInsetsCompat.Type.displayCutout());
            Insets ime=insets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(system.left,system.top,system.right,Math.max(system.bottom,ime.bottom));
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(root);UpdateWorker.schedule(this);
    }
}
