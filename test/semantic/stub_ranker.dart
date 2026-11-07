import 'dart:async';

import 'package:town_pass/service/service_rank_service.dart';
import 'package:town_pass/util/speech/voice_input.dart';

/// 測試用的假排名器：可指定狀態、結果、錯誤、延遲。
class StubRanker implements ServiceRanker {
  StubRanker({this.status = ServiceRankStatus.ready, this.result, this.error, this.delay});

  @override
  ServiceRankStatus status;
  Map<String, double>? result;
  Object? error;
  Duration? delay;
  final calls = <({String query, Set<String>? ids})>[];

  @override
  Future<Map<String, double>?> rank(String query, {Set<String>? ids}) async {
    calls.add((query: query, ids: ids));
    if (delay != null) await Future<void>.delayed(delay!);
    if (error != null) throw error!;
    return result;
  }
}

/// 測試用的假語音輸入。
class FakeVoice implements VoiceInput {
  FakeVoice(this.reply);

  Map<String, String> reply;
  bool cancelled = false;
  bool _listening = false;

  @override
  bool get isListening => _listening;

  @override
  Future<Map<String, String>> listenOnce({String locale = 'zh-TW'}) async {
    _listening = true;
    await Future<void>.delayed(const Duration(milliseconds: 10));
    _listening = false;
    return reply;
  }

  @override
  Future<void> cancel() async => cancelled = true;
}
