// Windows desktop launcher for image-audit DINOv2. No external Go modules.
// Serve bundled static assets and ONNX files from the extracted ZIP folder.
// localhost is required: browsers restrict Web Workers / WASM fetches on file://.
package main

import (
 "fmt"
 "log"
 "net"
 "net/http"
 "os"
 "os/exec"
 "path/filepath"
 "strings"
 "time"
)

func main() {
 exe, err := os.Executable()
 if err != nil { log.Fatal(err) }
 root := filepath.Dir(exe)
 if _, err := os.Stat(filepath.Join(root, "index.html")); err != nil {
   log.Fatal("無法找到 index.html；請先完整解壓縮 ZIP（含 assets 與 models）。")
 }
 if _, err := os.Stat(filepath.Join(root, "models")); err != nil {
   log.Fatal("無法找到 DINOv2 模型資料夾 models；請完整解壓縮 ZIP。")
 }
 listener, err := net.Listen("tcp", "127.0.0.1:0")
 if err != nil { log.Fatal("啟動本機伺服器失敗：", err) }
 url := "http://" + listener.Addr().String() + "/"
 handler := newHandler(root)
 server := &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second}
 go func() {
   if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
     log.Println("本機服務停止：", err)
   }
 }()
 fmt.Println("工程照片 AI 交叉稽核系統 v2.5.0 - DINOv2 / FAST-BRIEF / RANSAC / SSIM 桌面版")
 fmt.Println("全部跨批次配對之 DINOv2 + FAST/BRIEF、RANSAC、SSIM 於本機自動執行，無需安裝 Python / Node.js。")
 fmt.Println("系統網址：" + url)
 fmt.Println("請勿關閉此視窗，關閉後本機伺服器即停止。")
 if err := exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url).Start(); err != nil {
   fmt.Println("無法自動開啟瀏覽器，請複製上方網址至 Chrome 或 Edge。")
 }
 select{}
}

// newHandler serves index.html directly instead of rewriting "/" to "/index.html".
// Go's http.FileServer redirects /index.html back to /, which otherwise creates
// an infinite redirect loop. ServeContent bypasses that canonical redirect.
func newHandler(root string) http.Handler {
 fs := http.FileServer(http.Dir(root))
 mux := http.NewServeMux()
 mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
   w.Header().Set("X-Content-Type-Options", "nosniff")
   w.Header().Set("Cache-Control", "no-store")
   if r.URL.Path == "/" || r.URL.Path == "/index.html" {
     f, err := os.Open(filepath.Join(root, "index.html"))
     if err != nil { http.Error(w, "Unable to load index.html", http.StatusInternalServerError); return }
     defer f.Close()
     st, err := f.Stat()
     if err != nil { http.Error(w, "Unable to stat index.html", http.StatusInternalServerError); return }
     w.Header().Set("Content-Type", "text/html; charset=utf-8")
     http.ServeContent(w, r, "application.html", st.ModTime(), f)
     return
   }
   if strings.HasPrefix(r.URL.Path, "/models/") || strings.HasPrefix(r.URL.Path, "/assets/") || r.URL.Path == "/docxWriter.js" || r.URL.Path == "/docx-export.js" || r.URL.Path == "/comparator-core.js" || r.URL.Path == "/report-standard.js" || r.URL.Path == "/multi-folder-import.js" {
     fs.ServeHTTP(w, r)
     return
   }
   http.NotFound(w, r)
 })
 return mux
}
