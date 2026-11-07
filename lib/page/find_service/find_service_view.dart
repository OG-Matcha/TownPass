import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:town_pass/page/find_service/find_service_view_controller.dart';
import 'package:town_pass/util/semantic/service_search.dart';
import 'package:town_pass/util/tp_app_bar.dart';
import 'package:town_pass/util/tp_colors.dart';

// 樣式刻意與網頁版輔助選單裡的「找服務」（assets/a11y/tp-a11y.js）一致：
// 有框的輸入框、帶文字的「用講的／搜尋」雙按鈕、細邊框的圓角卡片、「都不是？打電話問 1999」。
// 所有可點的東西至少 64dp 高（網頁版也是 64px），主色底配深色字（白字對 #5AB4C5 只有約 2.3:1）。
const double _touch = 64;
const double _radius = 18;

/// 「找服務」：說一句想辦的事，列出最可能的服務。首頁的浮動鈕與微服務網頁的輔助選單都開這一頁。
class FindServiceView extends GetView<FindServiceViewController> {
  const FindServiceView({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: TPColors.grayscale50,
      appBar: const TPAppBar(title: '找服務'),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _SearchField(controller: controller),
              const SizedBox(height: 10),
              _ActionRow(controller: controller),
              const SizedBox(height: 12),
              Obx(
                () => Semantics(
                  liveRegion: true,
                  child: Text(
                    controller.status.value,
                    key: const Key('status'),
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: TPColors.grayscale900,
                    ),
                  ),
                ),
              ),
              Obx(
                () => controller.needsPack.value
                    ? Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: _Tile(
                          key: const Key('downloadPack'),
                          color: TPColors.primary500,
                          onTap: controller.downloadPack,
                          child: const Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(Icons.download, size: 28, color: TPColors.grayscale950),
                              SizedBox(width: 10),
                              Flexible(
                                child: Text(
                                  '下載離線語音（只要一次，需要網路）',
                                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: TPColors.grayscale950),
                                ),
                              ),
                            ],
                          ),
                        ),
                      )
                    : const SizedBox.shrink(),
              ),
              const SizedBox(height: 8),
              Expanded(
                child: Obx(() {
                  if (!controller.hasQuery.value) {
                    return _Examples(controller: controller);
                  }
                  return ListView.separated(
                    itemCount: controller.hits.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 10),
                    itemBuilder: (_, i) => _ResultTile(
                      hit: controller.hits[i],
                      offline: !controller.online.value && needsInternet(controller.hits[i].service),
                      onTap: () => controller.open(controller.hits[i]),
                    ),
                  );
                }),
              ),
              const SizedBox(height: 8),
              _Tile(
                key: const Key('call1999'),
                onTap: controller.call1999,
                child: const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.phone_outlined, size: 28, color: TPColors.grayscale950),
                    SizedBox(width: 10),
                    Text(
                      '都不是？打電話問 1999',
                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: TPColors.grayscale950),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 白底、細邊框、圓角、至少 64dp 高的可點區塊（網頁版的 .tile）。
class _Tile extends StatelessWidget {
  const _Tile({super.key, required this.child, required this.onTap, this.color = TPColors.white});

  final Widget child;
  final VoidCallback onTap;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final borderColor = color == TPColors.white ? TPColors.grayscale200 : Colors.transparent;
    return Material(
      color: color,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(_radius),
        side: BorderSide(color: borderColor),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(_radius),
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: _touch),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: child,
          ),
        ),
      ),
    );
  }
}

class _SearchField extends StatelessWidget {
  const _SearchField({required this.controller});

  final FindServiceViewController controller;

  @override
  Widget build(BuildContext context) {
    final border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(_radius),
      borderSide: const BorderSide(color: TPColors.grayscale500, width: 2),
    );
    return TextField(
      key: const Key('findServiceField'),
      controller: controller.text,
      focusNode: controller.focus,
      autofocus: true,
      textInputAction: TextInputAction.search,
      style: const TextStyle(fontSize: 18),
      onChanged: controller.onChanged,
      onSubmitted: controller.search,
      decoration: InputDecoration(
        hintText: '你想辦什麼事？例如：路燈壞了',
        hintStyle: const TextStyle(color: TPColors.grayscale600),
        filled: true,
        fillColor: TPColors.white,
        constraints: const BoxConstraints(minHeight: _touch),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
        enabledBorder: border,
        focusedBorder: border.copyWith(
          borderSide: const BorderSide(color: TPColors.primary700, width: 3),
        ),
        suffixIcon: Obx(
          () => controller.hasQuery.value
              ? IconButton(
                  key: const Key('clearQuery'),
                  tooltip: '清除',
                  iconSize: 28,
                  constraints: const BoxConstraints(minWidth: 56, minHeight: 56),
                  icon: const Icon(Icons.close),
                  onPressed: controller.clear,
                )
              : const SizedBox.shrink(),
        ),
      ),
    );
  }
}

/// 「用講的」與「搜尋」兩顆帶文字的按鈕（有文字比只有圖示好懂）。
class _ActionRow extends StatelessWidget {
  const _ActionRow({required this.controller});

  final FindServiceViewController controller;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Obx(
            () => _Tile(
              key: const Key('speak'),
              onTap: controller.speak,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    controller.listening.value ? Icons.stop : Icons.mic_none,
                    size: 28,
                    color: TPColors.primary800,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    controller.listening.value ? '停止' : '用講的',
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: TPColors.primary800),
                  ),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _Tile(
            key: const Key('search'),
            color: TPColors.primary500,
            onTap: () => controller.search(controller.text.text),
            child: const Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.search, size: 28, color: TPColors.grayscale950),
                SizedBox(width: 8),
                Text('搜尋', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: TPColors.grayscale950)),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _Examples extends StatelessWidget {
  const _Examples({required this.controller});

  final FindServiceViewController controller;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('常見問題', style: TextStyle(fontSize: 16, color: TPColors.grayscale700)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final example in searchExamples)
                ConstrainedBox(
                  constraints: const BoxConstraints(minHeight: _touch),
                  child: OutlinedButton(
                    style: OutlinedButton.styleFrom(
                      backgroundColor: TPColors.white,
                      foregroundColor: TPColors.grayscale950,
                      side: const BorderSide(color: TPColors.grayscale200),
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(_radius)),
                    ),
                    onPressed: () {
                      controller.text.text = example;
                      controller.hasQuery.value = true;
                      controller.search(example);
                    },
                    child: Text(example, style: const TextStyle(fontSize: 18)),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ResultTile extends StatelessWidget {
  const _ResultTile({required this.hit, required this.onTap, this.offline = false});

  final SearchHit hit;
  final bool offline;
  final VoidCallback onTap;

  /// 為什麼找到它。沒入口的服務也要說明，使用者才知道這個結果怎麼來的。
  String get _why {
    if (hit.reasons.isNotEmpty) return '因為提到「${hit.reasons.join('」「')}」';
    if (hit.semantic) return '意思和你說的很接近';
    return '';
  }

  /// 沒入口（還沒開通）的提醒，與「為什麼找到」分開兩行。
  String get _notice => hit.service.unavailable
      ? '這項服務還沒開通，可以撥 1999 詢問'
      : (offline ? '要連網' : '');

  String get _action => hit.service.unavailable ? '撥 1999' : (hit.service.tel.isNotEmpty ? '撥打' : '前往');

  @override
  Widget build(BuildContext context) {
    final why = _why;
    final notice = _notice;
    return Semantics(
      button: true,
      label: [
        '${hit.service.title}，${hit.service.desc}',
        if (why.isNotEmpty) why,
        if (notice.isNotEmpty) notice,
        _action,
      ].join('。'),
      excludeSemantics: true,
      child: _Tile(
        onTap: onTap,
        child: Row(
          children: [
            CircleAvatar(
              radius: 24,
              backgroundColor: TPColors.primary100,
              child: Text(
                hit.service.title.characters.first,
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: TPColors.primary800),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(hit.service.title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                  Text(hit.service.desc, style: const TextStyle(fontSize: 14, color: TPColors.grayscale600)),
                  if (why.isNotEmpty) Text(why, style: const TextStyle(fontSize: 14, color: TPColors.primary800)),
                  if (notice.isNotEmpty)
                    Text(notice, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: TPColors.grayscale700)),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(color: TPColors.primary500, borderRadius: BorderRadius.circular(16)),
              child: Text(
                _action,
                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: TPColors.grayscale950),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
