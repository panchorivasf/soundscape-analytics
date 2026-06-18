import { getCurrentWindow } from "@tauri-apps/api/window";
import { message } from "@tauri-apps/plugin-dialog";
import { t } from "./i18n";
import { getUnsavedLabelKeys, hasUnsavedWork } from "./unsavedWork";

export async function initExitGuard(): Promise<void> {
  await getCurrentWindow().onCloseRequested(async (event) => {
    if (!hasUnsavedWork()) return;

    const items = getUnsavedLabelKeys().map((key) => `• ${t(key)}`).join("\n");
    const body = `${t("exit.unsavedIntro")}\n\n${items}\n\n${t("exit.unsavedQuestion")}`;

    const result = await message(body, {
      title: t("exit.title"),
      kind: "warning",
      buttons: {
        yes: t("exit.stayAndDownload"),
        no: t("exit.exitWithoutSaving"),
        cancel: t("exit.cancel"),
      },
    });

    if (result === t("exit.stayAndDownload") || result === t("exit.cancel")) {
      event.preventDefault();
    }
  });
}
