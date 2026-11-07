// 單元測試：Dart 版規則搜尋與合併，與 JS 版逐題比對（標準答案 tool/semantic_search/parity.json 由 JS 算出）。
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:town_pass/page/find_service/find_service_view_controller.dart';
import 'package:town_pass/util/semantic/service_search.dart';

Map<String, dynamic> _json(String path) =>
    jsonDecode(File(path).readAsStringSync()) as Map<String, dynamic>;

void main() {
  final parity = _json('tool/semantic_search/parity.json');
  final scores =
      (_json('tool/semantic_search/scores.json')['variants'] as Map)['sim-sim']
          as Map<String, dynamic>;
  final catalog = buildSearchCatalog();

  group('與 JS 版一致（parity.json）', () {
    test('標準答案涵蓋 52 題（30＋22）', () => expect(parity['n'], 52));

    for (final row in (parity['rows'] as List).cast<Map<String, dynamic>>()) {
      test('${row['id']} ${row['text']}', () {
        final rule = ruleSearch(row['text'] as String, catalog);
        final wantRule = (row['rule'] as List).cast<List>();
        expect(
          rule.map((h) => h.service.id).toList(),
          wantRule.map((r) => r[0]).toList(),
          reason: '規則搜尋的服務順序',
        );
        expect(
          rule.map((h) => h.score).toList(),
          wantRule.map((r) => (r[1] as num).toDouble()).toList(),
          reason: '規則分數',
        );
        expect(
          rule.map((h) => h.reasons).toList(),
          wantRule.map((r) => (r[2] as List).cast<String>()).toList(),
          reason: '命中的關鍵字',
        );

        final raw =
            (scores[row['id']] as Map<String, dynamic>)['scores']
                as Map<String, dynamic>;
        final s = {
          for (final e in raw.entries) e.key: (e.value as num).toDouble(),
        };
        final merged = mergeRanking(rule, s, catalog);
        final wantMerged = (row['merged'] as List).cast<List>();
        expect(
          merged.map((h) => h.service.id).toList(),
          wantMerged.map((r) => r[0]).toList(),
          reason: '合併後的服務順序',
        );
        for (var i = 0; i < merged.length; i++) {
          expect(
            merged[i].score,
            closeTo((wantMerged[i][1] as num).toDouble(), 1e-5),
            reason: '合併分數 #$i',
          );
          expect(merged[i].semantic, wantMerged[i][2], reason: '語意標記 #$i');
          expect(merged[i].reasons, (wantMerged[i][3] as List).cast<String>());
        }
      });
    }
  });

  group('與 JS 版一致：關鍵字表與常見問題', () {
    test('serviceKeywords 與 JS 的 KEYWORDS 完全相同', () {
      final js = (parity['keywords'] as Map).map((k, v) => MapEntry(k as String, (v as List).cast<String>()));
      expect(serviceKeywords, js);
    });
    test('searchExamples 與 JS 的 SEARCH_EXAMPLES 完全相同', () {
      expect(searchExamples, (parity['examples'] as List).cast<String>());
    });
  });

  group('合併的邊界', () {
    final rules = [
      SearchHit(service: catalog[1], score: 5, reasons: const ['申請']),
    ];
    test(
      '分數是 null → 原封不動回傳規則結果',
      () =>
          expect(identical(mergeRanking(rules, null, catalog), rules), isTrue),
    );
    test(
      '分數太少 → 退回規則結果',
      () => expect(
        identical(mergeRanking(rules, {'a': 0.9, 'b': 0.8}, catalog), rules),
        isTrue,
      ),
    );
    test('所有分數相同（標準差 0）→ 退回規則結果', () {
      final same = {for (final s in catalog) s.id: 0.8};
      expect(identical(mergeRanking(rules, same, catalog), rules), isTrue);
    });
    test('NaN 與無限大的分數被忽略，不會讓結果壞掉', () {
      final s = {
        for (var i = 0; i < catalog.length; i++)
          catalog[i].id: 0.8 + (i % 3) * 0.005,
      };
      s[catalog[3].id] = 0.97;
      s[catalog[4].id] = double.nan;
      s[catalog[5].id] = double.infinity;
      expect(
        mergeRanking(const [], s, catalog).first.service.id,
        catalog[3].id,
      );
    });
    test('分數相同時維持清單原順序（排序要穩定）', () {
      // 規則結果給的順序是 7、2、4；輸出必須是目錄順序 2、4、7（同分不亂換）
      final tied = [
        for (final i in [7, 2, 4])
          SearchHit(service: catalog[i], score: 3, reasons: const ['x']),
      ];
      final flat = {
        for (var i = 0; i < catalog.length; i++)
          catalog[i].id: 0.8 + (i % 3) * 0.005,
      };
      final out = mergeRanking(tied, flat, catalog);
      expect(out.map((h) => h.service.id).toList(), [
        catalog[2].id,
        catalog[4].id,
        catalog[7].id,
      ]);
    });
    test('空字串、只有標點 → 空', () {
      expect(ruleSearch('', catalog), isEmpty);
      expect(ruleSearch('，。！', catalog), isEmpty);
    });
    test('正規化：臺→台、全形數字、標點、大小寫', () {
      expect(normalizeText('臺北 １９９９！ABC'), '台北1999abc');
    });
  });

  group('服務目錄', () {
    test('21 個服務，順序與 MyServiceItemId 相同；1999 走電話；沒網址的標為尚未開通', () {
      expect(catalog, hasLength(21));
      expect(catalog.first.id, 'dedicatedLine');
      expect(catalog.first.tel, '1999');
      expect(catalog.first.unavailable, isFalse);
      expect(catalog.where((s) => s.unavailable).length, 13);
      expect(
        catalog.firstWhere((s) => s.id == 'library').url,
        startsWith('https://'),
      );
    });
  });
}
