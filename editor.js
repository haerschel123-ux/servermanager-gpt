/* Datei-Browser, Suche und Text-Editor */
"use strict";

const Files = {
  currentDir: "",
  openPath: "",
  original: "",

  /* --------------------------------------------------------- Verzeichnis */

  async openDir(dir) {
    try {
      const data = await api("/api/files?dir=" + encodeURIComponent(dir));
      this.currentDir = data.dir;
      this.renderBreadcrumb();
      const list = $("#file-list");
      list.innerHTML = "";
      if (this.currentDir !== "/" && this.currentDir.includes("/")) {
        const up = document.createElement("li");
        up.textContent = "⬆️ ..";
        up.addEventListener("click", () =>
          this.openDir(this.currentDir.replace(/\/[^/]+$/, "") || "/"));
        list.appendChild(up);
      }
      data.entries.forEach((entry) => {
        const li = document.createElement("li");
        li.innerHTML = (entry.type === "dir" ? "📁 " : "📄 ") + esc(entry.name) +
          (entry.type === "file"
            ? '<span class="size">' + formatSize(entry.size) + "</span>" : "");
        li.addEventListener("click", () => {
          if (entry.type === "dir") this.openDir(entry.path);
          else this.openFile(entry.path);
        });
        list.appendChild(li);
      });
    } catch (err) {
      toast("Ordner konnte nicht geladen werden: " + err.message, "error");
    }
  },

  renderBreadcrumb() {
    const el = $("#breadcrumb");
    el.innerHTML = "";
    let acc = "";
    this.currentDir.split("/").forEach((part) => {
      if (!part) return;
      acc += "/" + part;
      const target = acc;
      const a = document.createElement("a");
      a.textContent = part;
      a.addEventListener("click", () => this.openDir(target));
      el.appendChild(document.createTextNode(" / "));
      el.appendChild(a);
    });
  },

  /* --------------------------------------------------------------- Datei */

  async openFile(path) {
    if (this.isDirty() &&
        !confirm("Ungespeicherte Änderungen verwerfen?")) return;
    try {
      const data = await api("/api/file?path=" + encodeURIComponent(path));
      this.openPath = data.path;
      this.original = data.content;
      $("#editor").value = data.content;
      $("#editor-path").textContent = data.path;
      this.updateDirty();
    } catch (err) {
      toast(err.message, "error");
    }
  },

  isDirty() {
    return this.openPath && $("#editor").value !== this.original;
  },

  updateDirty() {
    const dirty = this.isDirty();
    $("#editor-dirty").classList.toggle("hidden", !dirty);
    $("#btn-file-save").disabled = !dirty;
  },

  async save() {
    if (!this.openPath) return;
    try {
      await api("/api/file", { path: this.openPath, content: $("#editor").value });
      this.original = $("#editor").value;
      this.updateDirty();
      toast("Gespeichert: " + this.openPath.split("/").pop() +
            " (Backup angelegt). Änderungen gelten nach dem nächsten Neustart.");
    } catch (err) {
      toast("Speichern fehlgeschlagen: " + err.message, "error");
    }
  },

  /* --------------------------------------------------------------- Suche */

  async search() {
    const q = $("#file-search").value.trim();
    const box = $("#search-results");
    if (q.length < 2) {
      box.classList.add("hidden");
      return toast("Bitte mindestens 2 Zeichen eingeben.", "warn");
    }
    box.classList.remove("hidden");
    box.innerHTML = "<div class='result'>Suche läuft… (durchsucht den ganzen Server)</div>";
    try {
      const data = await api("/api/search?q=" + encodeURIComponent(q));
      box.innerHTML = "";
      if (!data.results.length) {
        let msg = "Nichts gefunden zu „" + esc(q) + "“.";
        if (q.toLowerCase().includes("init")) {
          msg += "<br><small>Hinweis: Eine <b>init.c</b> gibt es auf " +
            "Konsolenservern nicht – eigenes Scripting ist nur auf " +
            "PC-Servern möglich. Alles Anpassbare findest du im " +
            "Missionsordner (dayzOffline.…).</small>";
        }
        box.innerHTML = "<div class='result'>" + msg + "</div>";
        return;
      }
      data.results.forEach((entry) => {
        const div = document.createElement("div");
        div.className = "result";
        div.innerHTML = (entry.type === "dir" ? "📁 " : "📄 ") +
          esc(entry.name) + "<small>" + esc(entry.path) + "</small>";
        div.addEventListener("click", () => {
          if (entry.type === "dir") this.openDir(entry.path);
          else this.openFile(entry.path);
        });
        box.appendChild(div);
      });
    } catch (err) {
      box.classList.add("hidden");
      toast("Suche fehlgeschlagen: " + err.message, "error");
    }
  },
};

function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

$("#editor").addEventListener("input", () => Files.updateDirty());
$("#btn-file-save").addEventListener("click", () => Files.save());
$("#btn-search").addEventListener("click", () => Files.search());
$("#file-search").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") Files.search();
});
// Strg+S zum Speichern im Editor
document.addEventListener("keydown", (ev) => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key === "s" &&
      $("#tab-files").classList.contains("active")) {
    ev.preventDefault();
    Files.save();
  }
});

window.Files = Files;
