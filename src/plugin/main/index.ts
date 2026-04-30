import type { MainToUiMessage, UiToMainMessage } from "../../shared/types";
import { readSelectedSource, renderNewDocument, updateSelectedDocument } from "./renderer";

figma.showUI(__html__, { width: 520, height: 680, themeColors: true });
postToUi({ type: "ready" });
if (figma.editorType !== "figjam") {
  postToUi({ type: "render-error", message: "Mermaid Jam now generates native FigJam flows. Open this plugin from a FigJam board." });
}

figma.ui.onmessage = async (message: UiToMainMessage) => {
  try {
    switch (message.type) {
      case "generate": {
        const root = await renderNewDocument(message);
        postToUi({ type: "render-success", mode: "generate", nodeId: root.id, message: "Generated." });
        figma.notify("Mermaid Jam generated the diagram.");
        break;
      }
      case "update-selection": {
        const root = await updateSelectedDocument(message);
        postToUi({ type: "render-success", mode: "update", nodeId: root.id, message: "Updated." });
        figma.notify("Mermaid Jam updated the selected diagram.");
        break;
      }
      case "load-from-selection": {
        const { source, metadata } = readSelectedSource();
        postToUi({ type: "selection-source", source, metadata });
        break;
      }
      case "resize": {
        figma.ui.resize(message.width, message.height);
        break;
      }
      default:
        throw new Error("Unsupported plugin message.");
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    postToUi({ type: "render-error", message: messageText });
    if (message.type === "load-from-selection") postToUi({ type: "selection-source-error", message: messageText });
  }
};

function postToUi(message: MainToUiMessage): void {
  figma.ui.postMessage(message);
}
