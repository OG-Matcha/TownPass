import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:town_pass/page/find_service/find_service_button.dart';
import 'package:town_pass/page/main/main_view_controller.dart';
import 'package:town_pass/service/shared_preferences_service.dart';
import 'package:town_pass/util/tp_bottom_navigation_factory.dart';
import 'package:town_pass/util/tp_colors.dart';

class MainView extends GetView<MainViewController> {
  const MainView({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: Obx(() {
        // 讀 currentIndex：切換分頁時會重新判斷操作輔助有沒有開（設定頁改了開關，回來切一下分頁就會更新）
        controller.currentIndex.value;
        return const FindServiceButton();
      }),
      body: Obx(
        () => IndexedStack(
          index: controller.currentIndex.value,
          children: TPBottomNavigationFactory.viewList,
        ),
      ),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          boxShadow: [
            BoxShadow(
              color: Color(0x140B0D0E),
              blurRadius: 16,
              offset: Offset(0, -10),
              spreadRadius: 0,
            )
          ],
        ),
        child: Obx(
          () => BottomNavigationBar(
            type: BottomNavigationBarType.fixed,
            items: TPBottomNavigationFactory.barItemList,
            selectedItemColor: TPColors.primary500,
            unselectedItemColor: TPColors.grayscale950,
            selectedLabelStyle: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w400,
            ),
            unselectedLabelStyle: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w400,
            ),
            showUnselectedLabels: true,
            currentIndex: controller.currentIndex.value,
            onTap: (index) => controller.currentIndex.value = index,
          ),
        ),
      ),
    );
  }
}
