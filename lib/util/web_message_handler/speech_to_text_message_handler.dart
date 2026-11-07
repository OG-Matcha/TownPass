import 'dart:async';

import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:speech_to_text/speech_recognition_error.dart';
import 'package:speech_to_text/speech_recognition_result.dart';
import 'package:speech_to_text/speech_to_text.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';

/// 網頁 → App：`{ name: 'speech_to_text', data: { locale: 'zh-TW' } }`
/// App → 網頁：`{ name: 'speech_to_text', data: { text: '...' } }` 或 `{ data: { error: '...' } }`
///
/// 只用裝置端辨識（`onDevice: true`），符合「執行時 AI 推論必須在裝置端」；
/// 手機沒有下載中文離線語音時回傳錯誤，網頁會改請使用者打字。
class SpeechToTextMessageHandler extends TPWebMessageHandler {
  final SpeechToText _stt = SpeechToText();
  bool _ready = false;
  Completer<Map<String, String>>? _pending;

  @override
  String get name => 'speech_to_text';

  void _finish(Map<String, String> result) {
    final pending = _pending;
    if (pending != null && !pending.isCompleted) pending.complete(result);
  }

  void _onStatus(String status) {
    // 停止聆聽卻沒有最終結果 → 視為沒聽到
    if (status == SpeechToText.doneStatus || status == SpeechToText.notListeningStatus) {
      Future.delayed(const Duration(milliseconds: 300), () => _finish({'error': '沒有聽到聲音，請再說一次'}));
    }
  }

  void _onError(SpeechRecognitionError error) {
    final msg = switch (error.errorMsg) {
      'error_language_unavailable' || 'error_language_not_supported' =>
        '手機還沒有下載中文離線語音，請先用打字的',
      'error_no_match' || 'error_speech_timeout' => '沒有聽清楚，請再說一次',
      'error_permission' || 'error_insufficient_permissions' => '請允許使用麥克風',
      _ => '語音辨識失敗，請再說一次',
    };
    _finish({'error': msg});
  }

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage replyWebMessage)? onReply,
  }) async {
    final locale = (message is Map ? message['locale'] as String? : null) ?? 'zh-TW';

    if (!_ready) {
      _ready = await _stt.initialize(onStatus: _onStatus, onError: _onError);
    }
    if (!_ready) {
      onReply?.call(replyWebMessage(data: {'error': '這台手機無法使用語音輸入，請用打字的'}));
      return;
    }
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
        if (r.finalResult && r.recognizedWords.isNotEmpty) _finish({'text': r.recognizedWords});
      },
    );

    final result = await _pending!.future.timeout(
      const Duration(seconds: 20),
      onTimeout: () => {'error': '沒有聽到聲音，請再說一次'},
    );
    onReply?.call(replyWebMessage(data: result));
  }
}
