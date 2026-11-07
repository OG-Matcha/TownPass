import 'dart:async';

import 'package:speech_to_text/speech_recognition_error.dart';
import 'package:speech_to_text/speech_recognition_result.dart';
import 'package:speech_to_text/speech_to_text.dart';

/// 裝置端語音輸入（一次說一句）。網頁的 `speech_to_text` handler 與 Flutter 版「找服務」共用這一份。
///
/// 只用裝置端辨識（`onDevice: true`），符合「執行時 AI 推論必須在裝置端」；
/// 手機沒有下載中文離線語音時回傳 `error`，呼叫端改請使用者打字。
/// 回傳 `{'text': ...}` 或 `{'error': '給使用者看的說明'}`，不丟例外。
class VoiceInput {
  VoiceInput({SpeechToText? engine}) : _stt = engine ?? SpeechToText();

  final SpeechToText _stt;
  bool _ready = false;
  Completer<Map<String, String>>? _pending;

  bool get isListening => _stt.isListening;

  void _finish(Map<String, String> result) {
    final pending = _pending;
    if (pending != null && !pending.isCompleted) pending.complete(result);
  }

  void _onStatus(String status) {
    // 停止聆聽卻沒有最終結果 → 視為沒聽到
    if (status == SpeechToText.doneStatus ||
        status == SpeechToText.notListeningStatus) {
      Future.delayed(
        const Duration(milliseconds: 300),
        () => _finish({'error': '沒有聽到聲音，請再說一次'}),
      );
    }
  }

  void _onError(SpeechRecognitionError error) {
    final msg = switch (error.errorMsg) {
      'error_language_unavailable' ||
      'error_language_not_supported' => '手機還沒有下載中文離線語音，請先用打字的',
      'error_no_match' || 'error_speech_timeout' => '沒有聽清楚，請再說一次',
      'error_permission' || 'error_insufficient_permissions' => '請允許使用麥克風',
      _ => '語音辨識失敗，請再說一次',
    };
    _finish({'error': msg});
  }

  Future<Map<String, String>> listenOnce({String locale = 'zh-TW'}) async {
    try {
      if (!_ready) {
        _ready = await _stt.initialize(onStatus: _onStatus, onError: _onError);
      }
      if (!_ready) return {'error': '這台手機無法使用語音輸入，請用打字的'};
      if (_stt.isListening) await _stt.cancel();

      _pending = Completer<Map<String, String>>();
      await _stt.listen(
        listenOptions: SpeechListenOptions(
          localeId: locale.replaceAll('-', '_'),
          listenFor: const Duration(seconds: 15),
          pauseFor: const Duration(seconds: 3),
          onDevice: true,
          partialResults: false,
          cancelOnError: true,
          listenMode: ListenMode.search,
        ),
        onResult: (SpeechRecognitionResult r) {
          if (r.finalResult && r.recognizedWords.isNotEmpty) {
            _finish({'text': r.recognizedWords});
          }
        },
      );
      return await _pending!.future.timeout(
        const Duration(seconds: 20),
        onTimeout: () => {'error': '沒有聽到聲音，請再說一次'},
      );
    } catch (_) {
      return {'error': '語音辨識失敗，請改用打字'};
    }
  }

  Future<void> cancel() async {
    if (_stt.isListening) await _stt.cancel();
    _finish({'error': '已取消'});
  }
}
