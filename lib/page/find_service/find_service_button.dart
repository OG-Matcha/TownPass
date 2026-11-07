import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:town_pass/util/a11y/a11y_layer.dart';
import 'package:town_pass/util/tp_colors.dart';
import 'package:town_pass/util/tp_route.dart';

/// 首頁（原生畫面）的「找服務」浮動鈕。設定裡關掉「操作輔助」時不顯示，與微服務網頁上的行為一致。
///
/// 外觀與網頁版輔助鈕（assets/a11y/tp-a11y.js 的 #fab）一致：64 圓形、2px 深色細框、主色底、
/// 圖示加小字標籤、深色字（白字對 #5AB4C5 只有約 2.3:1）。
class FindServiceButton extends StatelessWidget {
  const FindServiceButton({super.key, this.enabled});

  /// 測試用：直接指定要不要顯示；不給就讀設定。
  final bool? enabled;

  static const double size = 64;

  @override
  Widget build(BuildContext context) {
    if (!(enabled ?? A11yLayer.enabled)) return const SizedBox.shrink();
    return SizedBox(
      key: const Key('findServiceButton'),
      width: size,
      height: size,
      child: Semantics(
        button: true,
        label: '找服務',
        excludeSemantics: true,
        child: Material(
          color: TPColors.primary500,
          elevation: 6,
          shadowColor: const Color(0x520B0D0E),
          shape: const CircleBorder(side: BorderSide(color: TPColors.primary800, width: 2)),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: () => Get.toNamed(TPRoute.findService),
            child: const Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.search, size: 26, color: TPColors.grayscale900),
                Text(
                  '找服務',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: TPColors.grayscale900, height: 1.1),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
