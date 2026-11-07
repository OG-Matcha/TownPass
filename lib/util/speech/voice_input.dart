import 'dart:async';

import 'package:flutter/foundation.dart';

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
  /// 這一次聽到的最新文字（含中間結果）。Google 裝置端辨識有時「結束」通知比「最終結果」先到，
  /// 結束時有字就用它，不要回「沒聽到」。
  String _heard = '';

  bool get isListening => _stt.isListening;

  void _finish(Map<String, String> result) {
    final pending = _pending;
    if (pending != null && !pending.isCompleted) pending.complete(result);
  }

  void _onStatus(String status) {
    // 停止聆聽卻沒有最終結果 → 視為沒聽到
    debugPrint('TPVoice status=$status heard=${_heard.length}');
    if (status == SpeechToText.doneStatus ||
        status == SpeechToText.notListeningStatus) {
      Future.delayed(
        const Duration(milliseconds: 1200),
        () => _finish(_heard.isNotEmpty ? {'text': _heard} : {'error': '沒有聽到聲音，請再說一次'}),
      );
    }
  }

  void _onError(SpeechRecognitionError error) {
    debugPrint('TPVoice error=${error.errorMsg} permanent=${error.permanent} heard=${_heard.length}');
    if (_heard.isNotEmpty) {
      _finish({'text': _heard});
      return;
    }
    if (error.errorMsg == 'error_language_unavailable' ||
        error.errorMsg == 'error_language_not_supported') {
      _finish({'error': '手機還沒有下載中文離線語音', 'code': 'needs_pack'});
      return;
    }
    final msg = switch (error.errorMsg) {
      'error_language_unavailable' ||
      'error_language_not_supported' => '手機還沒有下載中文離線語音，請先用打字的',
      'error_no_match' || 'error_speech_timeout' => '沒有聽清楚，請再說一次',
      'error_permission' || 'error_insufficient_permissions' => '請允許使用麥克風',
      _ => '語音辨識失敗，請再說一次',
    };
    _finish({'error': msg});
  }

  static String _packTag(String locale) {
    final l = locale.replaceAll('_', '-').toLowerCase();
    if (l == 'zh-tw' || l == 'zh-hant-tw' || l == 'zh-hant') return 'cmn-Hant-TW';
    return locale;
  }

  Future<Map<String, String>> listenOnce({String locale = 'zh-TW'}) async {
    try {
      if (!_ready) {
        _ready = await _stt.initialize(onStatus: _onStatus, onError: _onError);
      }
      if (!_ready) return {'error': '這台手機無法使用語音輸入，請用打字的'};
      if (_stt.isListening) await _stt.cancel();

      _pending = Completer<Map<String, String>>();
      _heard = '';
      await _stt.listen(
        listenOptions: SpeechListenOptions(
          // Google 裝置端辨識的中文（台灣）語音包登記為 cmn-Hant-TW。傳 zh-TW 時，若剛好等於手機系統語言，
          // speech_to_text 會省略 EXTRA_LANGUAGE，辨識器就退回英文 → 一律換成語音包的標籤。
          localeId: _packTag(locale).replaceAll('-', '_'),
          listenFor: const Duration(seconds: 15),
          pauseFor: const Duration(seconds: 3),
          onDevice: true,
          partialResults: true,
          cancelOnError: true,
          listenMode: ListenMode.search,
        ),
        onResult: (SpeechRecognitionResult r) {
          debugPrint('TPVoice result final=${r.finalResult} len=${r.recognizedWords.length}');
          if (r.recognizedWords.isNotEmpty) _heard = r.recognizedWords;
          if (r.finalResult && r.recognizedWords.isNotEmpty) {
            _finish({'text': r.recognizedWords});
          }
        },
      );
      return await _pending!.future.timeout(
        const Duration(seconds: 20),
        onTimeout: () => _heard.isNotEmpty ? {'text': _heard} : {'error': '沒有聽到聲音，請再說一次'},
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
