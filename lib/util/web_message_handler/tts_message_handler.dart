import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';

/// 網頁 → App：`{ name: 'tts', data: { text: '...', rate: 0.85, locale: 'zh-TW' } }`
/// `text` 空字串 = 停止朗讀。App → 網頁：`{ name: 'tts', data: { ok: true } }` 或 `{ data: { error: '...' } }`
///
/// Android WebView 沒有 Web Speech API 的 speechSynthesis，所以朗讀交給系統 TTS（裝置端合成，不連網）。
/// `rate` 以「1 = 正常語速」計；flutter_tts 的 0.5 才是正常語速，所以乘 0.5。
class TtsMessageHandler extends TPWebMessageHandler {
  final FlutterTts _tts = FlutterTts();
  String? _locale;

  @override
  String get name => 'tts';

  /// 同語言（zh-TW ≈ zh_TW ≈ cmn-TW）、不需要網路、已安裝的語音；找不到回 null。
  Future<Map<String, String>?> _offlineVoice(String locale) async {
    final want = locale.toLowerCase().replaceAll('_', '-');
    final region = want.contains('-') ? want.split('-').last : '';
    final lang = want.split('-').first;
    final voices = ((await _tts.getVoices) as List?) ?? const [];
    for (final v in voices) {
      if (v is! Map) continue;
      final loc = '${v['locale'] ?? ''}'.toLowerCase().replaceAll('_', '-');
      final sameLang = loc.startsWith('$lang-') || loc == lang || (lang == 'zh' && loc.startsWith('cmn-'));
      if (!sameLang || (region.isNotEmpty && !loc.endsWith('-$region'))) continue;
      final network = '${v['network_required'] ?? ''}';
      final features = '${v['features'] ?? ''}';
      final name = '${v['name'] ?? ''}';
      if (network == '1' || network == 'true' || name.contains('network') || name.endsWith('-server')) continue;
      if (features.contains('notInstalled')) continue;
      return {'name': name, 'locale': '${v['locale']}'};
    }
    return null;
  }

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage replyWebMessage)? onReply,
  }) async {
    final data = message is Map ? message : const {};
    final text = (data['text'] as String? ?? '').trim();
    final rate = (data['rate'] as num? ?? 0.85).toDouble().clamp(0.3, 1.5);
    final locale = data['locale'] as String? ?? 'zh-TW';

    try {
      await _tts.stop();
      if (text.isEmpty) {
        onReply?.call(replyWebMessage(data: {'ok': true}));
        return;
      }
      if (_locale != locale) {
        if (await _tts.isLanguageAvailable(locale) != true) {
          onReply?.call(replyWebMessage(data: {'error': '這台手機沒有中文語音，請到設定下載「文字轉語音」中文語音'}));
          return;
        }
        await _tts.setLanguage(locale);
        // 只用裝置端語音：Google 語音引擎在沒有離線語音時會改用雲端合成（例如 cmn-tw-x-ctc-server），
        // 違反「執行時推論在裝置端」，飛航模式也念不出來 → 明確挑一個不需要網路、已安裝的同語言語音。
        final voice = await _offlineVoice(locale);
        if (voice == null) {
          _locale = null;
          onReply?.call(replyWebMessage(data: {'error': '這台手機沒有離線中文語音，請到設定的「文字轉語音」下載中文語音'}));
          return;
        }
        await _tts.setVoice(voice);
        _locale = locale;
      }
      await _tts.setSpeechRate(rate * 0.5);
      await _tts.speak(text);
      onReply?.call(replyWebMessage(data: {'ok': true}));
    } catch (_) {
      onReply?.call(replyWebMessage(data: {'error': '朗讀失敗'}));
    }
  }
}
