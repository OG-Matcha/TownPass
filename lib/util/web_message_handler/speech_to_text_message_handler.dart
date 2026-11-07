import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:town_pass/util/speech/voice_input.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';

/// 網頁 → App：`{ name: 'speech_to_text', data: { locale: 'zh-TW' } }`
/// App → 網頁：`{ name: 'speech_to_text', data: { text: '...' } }` 或 `{ data: { error: '...' } }`；
/// 缺離線語音包時為 `{ error: '...', code: 'needs_pack' }`，網頁可再送 `speech_pack` 觸發下載。
///
/// 辨識邏輯在 [VoiceInput]（與 Flutter 版「找服務」共用）：只用裝置端辨識，
/// 手機沒有下載中文離線語音時回傳錯誤，網頁會改請使用者打字。
class SpeechToTextMessageHandler extends TPWebMessageHandler {
  final VoiceInput _voice = VoiceInput();

  @override
  String get name => 'speech_to_text';

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage replyWebMessage)? onReply,
  }) async {
    final locale = (message is Map ? message['locale'] as String? : null) ?? 'zh-TW';
    onReply?.call(replyWebMessage(data: await _voice.listenOnce(locale: locale)));
  }
}
