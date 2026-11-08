import { createApp } from "vue";
import "./style.css";
import App from "./App.vue";

// 畫面切換用 hash 路由（src/lib/router.ts）：#/、#/pick/origin、#/result、#/trip、#/family/<id>
createApp(App).mount("#app");
