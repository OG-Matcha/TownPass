package com.example.townpass

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

@SuppressLint("NewApi")
class MainActivity : FlutterActivity() {
    private val TAG = "TPSpeech"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "town_pass/speech_pack")
            .setMethodCallHandler { call, result ->
                if (call.method != "download") {
                    result.notImplemented()
                    return@setMethodCallHandler
                }
                val locale = call.argument<String>("locale") ?: "zh-TW"
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                    result.success("unsupported")
                    return@setMethodCallHandler
                }
                try {
                    if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) {
                        Log.i(TAG, "on-device recognition not available")
                        result.success("unavailable")
                        return@setMethodCallHandler
                    }
                    val recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(this)
                    fun intentFor(tag: String) = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                        putExtra(RecognizerIntent.EXTRA_LANGUAGE, tag)
                    }
                    val candidates = linkedSetOf(locale, "cmn-Hant-TW", "zh-TW", "zh-Hant-TW")
                    var replied = false
                    fun reply(r: String) {
                        if (replied) return
                        replied = true
                        result.success(r)
                        Handler(Looper.getMainLooper()).postDelayed({ recognizer.destroy() }, 3000)
                    }
                    fun fallbackDownload() {
                        // 查不到支援清單時，依序嘗試各標籤直接觸發下載
                        try {
                            recognizer.triggerModelDownload(intentFor(locale))
                            reply("ok")
                        } catch (e: Exception) {
                            Log.i(TAG, "triggerModelDownload failed: $e")
                            reply("error")
                        }
                    }
                    recognizer.checkRecognitionSupport(
                        intentFor(locale),
                        mainExecutor,
                        object : RecognitionSupportCallback {
                            override fun onSupportResult(support: RecognitionSupport) {
                                val installed = support.installedOnDeviceLanguages
                                val pending = support.pendingOnDeviceLanguages
                                val supported = support.supportedOnDeviceLanguages
                                val online = support.onlineLanguages
                                Log.i(TAG, "installed=$installed pending=$pending downloadable(supported)=$supported online=$online")
                                if (candidates.any { it in installed }) {
                                    reply("installed")
                                    return
                                }
                                val tag = candidates.firstOrNull { it in supported || it in pending }
                                if (tag == null) {
                                    Log.i(TAG, "no zh tag in supported on-device languages")
                                    reply("unavailable")
                                    return
                                }
                                Log.i(TAG, "triggerModelDownload tag=$tag")
                                try {
                                    recognizer.triggerModelDownload(intentFor(tag))
                                    reply("ok")
                                } catch (e: Exception) {
                                    Log.i(TAG, "triggerModelDownload failed: $e")
                                    reply("error")
                                }
                            }

                            override fun onError(error: Int) {
                                Log.i(TAG, "checkRecognitionSupport error=$error")
                                fallbackDownload()
                            }
                        },
                    )
                } catch (e: Exception) {
                    Log.i(TAG, "speech_pack exception: $e")
                    result.success("error")
                }
            }
    }
}
