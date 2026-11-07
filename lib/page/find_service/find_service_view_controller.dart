import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:town_pass/page/city_service/model/my_service_model.dart';
import 'package:town_pass/service/service_rank_service.dart';
import 'package:town_pass/util/semantic/service_search.dart';
import 'package:town_pass/util/speech/speech_pack.dart';
import 'package:town_pass/util/speech/voice_input.dart';
import 'package:town_pass/util/tp_route.dart';
import 'package:url_launcher/url_launcher_string.dart';

/// App 的 21 個服務 → 搜尋用的目錄。1999 走電話；沒有網址的服務標為尚未開通。
List<SearchService> buildSearchCatalog() {
  return [
    for (final id in MyServiceItemId.values)
      SearchService(
        id: id.name,
        title: id.item.title,
        desc: id.item.description,
        tel: id == MyServiceItemId.dedicatedLine ? '1999' : '',
        url: id == MyServiceItemId.dedicatedLine ? '' : id.item.destinationUrl,
      ),
  ];
}

/// 這個服務的網頁要連網才開得了（本機打包的頁面、電話、沒入口的都不用）。
bool needsInternet(SearchService s) {
  if (s.tel.isNotEmpty || s.url.isEmpty) return false;
  final host = Uri.tryParse(s.url)?.host ?? '';
  return host != 'localhost' && host != '127.0.0.1';
}

/// 便宜的連網檢查：短逾時的 DNS 查詢，不需新套件。
Future<bool> defaultIsOnline() async {
  try {
    final r = await InternetAddress.lookup('one.one.one.one').timeout(const Duration(seconds: 2));
    return r.isNotEmpty && r.first.rawAddress.isNotEmpty;
  } catch (_) {
    return false;
  }
}

/// 「找服務」畫面的邏輯。首頁與微服務網頁共用這一份。
///
/// 流程：先算規則結果（永遠可用），模型準備好時再向 [ServiceRanker] 要語意分數合併；
/// 語意出任何狀況（沒準備好、逾時、出錯）都直接用規則結果，畫面不顯示錯誤。
/// 使用者說的話只在裝置上處理，不送出、不記錄。
class FindServiceViewController extends GetxController {
  FindServiceViewController({
    this._ranker,
    List<SearchService>? catalog,
    VoiceInput? voice,
    Future<void> Function(String tel)? onCall,
    Future<void> Function(String url)? onOpenUrl,
    Future<bool> Function()? isOnline,
    Future<Map<String, String>> Function()? onDownloadPack,
    this.debounce = const Duration(milliseconds: 250),
    this.rankTimeout = const Duration(seconds: 2),
  }) : _voice = voice ?? VoiceInput(),
       catalog = catalog ?? buildSearchCatalog(),
       _onCall = onCall ?? ((tel) async => launchUrlString('tel://$tel')),
       _onOpenUrl = onOpenUrl ?? ((url) async => TPRoute.openUri(uri: url)),
       _isOnline = isOnline ?? defaultIsOnline,
       _onDownloadPack = onDownloadPack ?? SpeechPack.download;

  final ServiceRanker? _ranker;
  final VoiceInput _voice;
  final Future<void> Function(String tel) _onCall;
  final Future<void> Function(String url) _onOpenUrl;
  final Future<bool> Function() _isOnline;
  final Future<Map<String, String>> Function() _onDownloadPack;
  final List<SearchService> catalog;
  final Duration debounce;
  final Duration rankTimeout;

  final TextEditingController text = TextEditingController();
  final FocusNode focus = FocusNode();
  final RxList<SearchHit> hits = <SearchHit>[].obs;
  final RxString status = ''.obs;
  final RxBool hasQuery = false.obs;
  final RxBool listening = false.obs;
  final RxBool online = true.obs;
  final RxBool needsPack = false.obs;

  @override
  void onInit() {
    super.onInit();
    unawaited(refreshOnline());
  }

  Future<void> refreshOnline() async {
    online.value = await _isOnline();
  }

  Timer? _timer;
  int _token = 0;

  ServiceRanker? get _resolvedRanker =>
      _ranker ??
      (Get.isRegistered<ServiceRankService>()
          ? Get.find<ServiceRankService>()
          : null);

  SearchService get line1999 => catalog.firstWhere(
    (s) => s.tel.isNotEmpty,
    orElse: () => const SearchService(
      id: 'dedicatedLine',
      title: '1999',
      desc: '',
      tel: '1999',
    ),
  );

  /// 輸入框內容改變：稍等一下再搜，避免每打一個字就跑一次模型。
  void onChanged(String value) {
    hasQuery.value = value.trim().isNotEmpty;
    _timer?.cancel();
    _timer = Timer(debounce, () => search(value));
  }

  void clear() {
    _timer?.cancel();
    text.clear();
    hasQuery.value = false;
    unawaited(search(''));
    focus.requestFocus();
  }

  /// 搜尋。只有最新一次查詢的結果會被畫出來（舊的慢回覆不會蓋掉新的）。
  Future<void> search(String raw) async {
    final q = raw.trim();
    final token = ++_token;
    if (q.isEmpty) {
      hits.clear();
      status.value = '';
      return;
    }
    final rule = ruleSearch(q, catalog);
    Map<String, double>? scores;
    final ranker = _resolvedRanker;
    if (ranker != null && ranker.status == ServiceRankStatus.ready) {
      status.value = '找找看…';
      try {
        scores = await ranker
            .rank(q, ids: catalog.map((s) => s.id).toSet())
            .timeout(rankTimeout);
      } catch (_) {
        scores = null; // 無聲退回規則搜尋
      }
      if (token != _token) return;
    }
    List<SearchHit> merged;
    try {
      merged = mergeRanking(rule, scores, catalog);
    } catch (_) {
      merged = rule;
    }
    // 還沒開通（沒網址也沒電話）的服務不列出來：點了是死路；全部找不到時下面會引導撥 1999
    merged = merged.where((h) => !h.service.unavailable).toList();
    hits.assignAll(merged);
    status.value = merged.isEmpty
        ? '找不到相關的服務，可以換個說法，或打電話問 1999'
        : '找到 ${merged.length} 個可能的服務';
  }

  /// 點結果：有網址就前往；沒入口（還沒開通）或是 1999 就撥電話。
  Future<void> open(SearchHit hit) async {
    final sv = hit.service;
    if (sv.tel.isNotEmpty) return _onCall(sv.tel);
    if (sv.unavailable) return _onCall(line1999.tel);
    if (needsInternet(sv)) {
      await refreshOnline();
      if (!online.value) {
        status.value = '現在沒有網路，「${sv.title}」要連網才能用。連上網路後再試，或打電話問 1999';
        return;
      }
    }
    return _onOpenUrl(sv.url);
  }

  Future<void> call1999() => _onCall(line1999.tel);

  /// 用講的輸入（裝置端辨識）。失敗時顯示說明並請使用者改打字。
  Future<void> speak() async {
    if (listening.value) {
      await _voice.cancel();
      return;
    }
    listening.value = true;
    needsPack.value = false;
    status.value = '請說你想辦什麼事';
    final result = await _voice.listenOnce();
    listening.value = false;
    final spoken = result['text'];
    if (spoken != null && spoken.trim().isNotEmpty) {
      text.text = spoken;
      hasQuery.value = true;
      await search(spoken);
    } else {
      status.value = result['error'] ?? '沒有聽清楚，請再說一次';
      needsPack.value = result['code'] == 'needs_pack';
      focus.requestFocus();
    }
  }

  /// 一鍵下載離線語音包（要網路，只需一次）。
  Future<void> downloadPack() async {
    final r = await _onDownloadPack();
    if (r['ok'] != null) {
      needsPack.value = false;
      status.value = '已開始下載離線語音，完成後再按「用講的」';
    } else {
      status.value = r['error'] ?? '無法開始下載';
    }
  }

  @override
  void onClose() {
    _timer?.cancel();
    text.dispose();
    focus.dispose();
    super.onClose();
  }
}
