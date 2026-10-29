package com.spotifydashboard.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.community.database.sqlite.CapacitorSQLitePlugin;
import com.spotifydashboard.librespot.LibrespotPlayerPlugin;
import io.capawesome.capacitorjs.plugins.filepicker.FilePickerPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CapacitorSQLitePlugin.class);
        registerPlugin(FilePickerPlugin.class);
        registerPlugin(AddFromSitePlugin.class);
        registerPlugin(LibrespotPlayerPlugin.class);
        // Browser, App, Preferences auto-register via @CapacitorPlugin annotation
        super.onCreate(savedInstanceState);
    }
}
