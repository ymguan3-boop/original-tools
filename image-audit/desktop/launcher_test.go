package main

import (
 "net/http"
 "net/http/httptest"
 "os"
 "path/filepath"
 "strings"
 "testing"
)

func TestDesktopLauncherNoRedirect(t *testing.T) {
 root := t.TempDir()
 for _,name := range []string{"index.html","docxWriter.js","docx-export.js","comparator-core.js","report-standard.js","assets/main.js","models/Xenova/dinov2-small/onnx/model_quantized.onnx"} {
   path := filepath.Join(root,filepath.FromSlash(name))
   if err:=os.MkdirAll(filepath.Dir(path),0755);err!=nil {t.Fatal(err)}
   if err:=os.WriteFile(path,[]byte("sample"),0644);err!=nil {t.Fatal(err)}
 }
 handler:=newHandler(root)
 for _,path := range []string{"/","/index.html","/docxWriter.js","/docx-export.js","/comparator-core.js","/report-standard.js","/assets/main.js","/models/Xenova/dinov2-small/onnx/model_quantized.onnx"} {
   r := httptest.NewRequest(http.MethodGet,path,nil)
   w := httptest.NewRecorder()
   handler.ServeHTTP(w,r)
   if w.Code!=200 {t.Fatalf("%s: expected 200 without redirect; got %d Location=%s",path,w.Code,w.Header().Get("Location"))}
   if strings.TrimSpace(w.Body.String())!="sample" {t.Fatalf("%s response body unexpected",path)}
 }
 r:=httptest.NewRequest(http.MethodGet,"/unknown",nil)
 w:=httptest.NewRecorder()
 handler.ServeHTTP(w,r)
 if w.Code!=404 {t.Fatalf("missing route: expected 404, got %d",w.Code)}
}
