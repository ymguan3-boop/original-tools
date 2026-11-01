//go:build windows

// PDF AI Video Studio portable launcher. The Python requirement is checked
// BEFORE attempting to install dependencies or launch the HTML workbench.
package main

import (
	"errors"
	"encoding/json"
	"io"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const downloadPython = "https://www.python.org/downloads/windows/"
const studioURL = "http://127.0.0.1:8765/pdf-ai-video-studio/"

var (
	user32 = syscall.NewLazyDLL("user32.dll")
	messageBox = user32.NewProc("MessageBoxW")
)

func dialog(title, message string, flags uintptr) int {
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(message)
	n, _, _ := messageBox.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), flags)
	return int(n)
}
func openURL(url string) {
	_ = exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url).Start()
}
func pyVersion(out string) bool {
	part := strings.Fields(strings.TrimSpace(out))
	if len(part) < 2 || part[0] != "Python" {
		return false
	}
	segments := strings.Split(part[1], ".")
	if len(segments) < 2 { return false }
	major, e1 := strconv.Atoi(segments[0])
	minor, e2 := strconv.Atoi(segments[1])
	return e1 == nil && e2 == nil && major == 3 && minor >= 10 && minor <= 14
}
func findPython() ([]string, string, error) {
	// Prefer stable versions to very new CPython builds that might lack wheels.
	candidates := [][]string{
		{"py", "-3.12"}, {"py", "-3.13"}, {"py", "-3.11"},
		{"py", "-3.10"}, {"py", "-3.14"},
		{"python"}, {"python3"}, {"py", "-3"},
	}
	for _, a := range candidates {
		cmd := exec.Command(a[0], append(a[1:], "--version")...)
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow:true}
		o, err := cmd.CombinedOutput()
		if err != nil || !pyVersion(string(o)) { continue }
		return a, strings.TrimSpace(string(o)), nil
	}
	return nil, "", errors.New("Python 3.10–3.14 not found")
}
func pythonCommand(parts []string, args ...string) *exec.Cmd {
	return exec.Command(parts[0], append(append([]string{}, parts[1:]...), args...)...)
}
func runWait(parts []string, log *os.File, args ...string) error {
	cmd := pythonCommand(parts, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow:true}
	cmd.Stdout, cmd.Stderr = log, log
	return cmd.Run()
}
func running() bool {
	// Require our own app health marker, not merely any process occupying 8765.
	client := http.Client{Timeout:1200*time.Millisecond}
	res, err := client.Get("http://127.0.0.1:8765/health")
	if err != nil { return false }
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK { return false }
	var payload struct {
		OK bool `json:"ok"`
		Desktop bool `json:"desktop"`
	}
	reader := io.LimitReader(res.Body, 8192)
	return json.NewDecoder(reader).Decode(&payload) == nil && payload.OK && payload.Desktop
}
func fail(message string) { dialog("PDF 智慧影音製作系統", message, 0x10) }
func main() {
	self, err := os.Executable()
	if err != nil { fail("無法確認啟動器位置。"); return }
	base := filepath.Dir(self)
	server := filepath.Join(base, "pdf-ai-video-studio", "local-service", "server.py")
	requirements := filepath.Join(base, "pdf-ai-video-studio", "local-service", "requirements.txt")
	if _, err := os.Stat(server); err != nil { fail("缺少本機 AI 服務檔案。請完整解壓縮下載的 ZIP，不要只複製 EXE。"); return }
	if running() {
		openURL(studioURL)
		return
	}
	parts, version, err := findPython()
	if err != nil {
		message := "未偵測到相容的 Python（需要 Python 3.10–3.14，建議 3.12 或 3.13）。\n\n" +
			"請到 Python 官方網站下載 Windows 安裝程式，安裝完成後重新雙擊本啟動器。\n\n" +
			"官方網址：\n" + downloadPython + "\n\n" +
			"按「是」將自動開啟 Python 官方下載頁。"
		if dialog("需要先安裝 Python",message,0x04|0x30)==6 { openURL(downloadPython) }
		return
	}
	venv := filepath.Join(base,"pdf-ai-video-studio","local-service",".venv")
	venvExe := filepath.Join(venv,"Scripts","python.exe")
	logPath := filepath.Join(base,"pdf-studio-launch.log")
	log, err := os.OpenFile(logPath,os.O_CREATE|os.O_WRONLY|os.O_APPEND,0600)
	if err != nil { fail("無法寫入資料夾。請將 ZIP 解壓縮到可寫入的位置，例如文件資料夾。"); return }
	defer log.Close()
	if _, err := os.Stat(venvExe); err != nil {
		dialog("首次設定","已找到 "+version+"。\n\n首次啟動會建立獨立 Python 虛擬環境；不會更動系統 Python。\n接下來可能需要網路安裝少量必要套件。",0x40)
		if err := runWait(parts,log,"-m","venv",venv); err != nil {
			fail("無法建立 Python 環境。請檢查磁碟可寫入權限及 Python 是否完整安裝。\n詳見 pdf-studio-launch.log")
			return
		}
	}
	venvParts:=[]string{venvExe}
	verify:=pythonCommand(venvParts,"-c","import edge_tts, httpx")
	verify.SysProcAttr=&syscall.SysProcAttr{HideWindow:true}
	if verify.Run()!=nil {
		if dialog("首次安裝套件",
			"已偵測到 Python。\n\n需要由 PyPI 安裝 Edge-TTS 及 httpx 依賴套件。\n\n是否繼續？\n\n取消可保留現有檔案，不會執行安裝。",
			0x04|0x20)!=6 { return }
		if err := runWait(venvParts,log,"-m","pip","install","--disable-pip-version-check","-r",requirements); err != nil {
			fail("Python 套件安裝失敗。請確認網路與磁碟空間，詳見 pdf-studio-launch.log")
			return
		}
	}
	cmd:=exec.Command(venvExe,server)
	cmd.Dir=filepath.Dir(server)
	cmd.Stdout,cmd.Stderr=log,log
	cmd.SysProcAttr=&syscall.SysProcAttr{HideWindow:true}
	if err:=cmd.Start();err!=nil { fail(fmt.Sprintf("本機服務無法啟動：%v",err));return }
	_ = cmd.Process.Release()
	for i:=0;i<50;i++ {
		if running() { openURL(studioURL); return }
		time.Sleep(200*time.Millisecond)
	}
	fail("本機服務未能啟動，或連接埠 8765 已被其他程式占用。\n請查看 pdf-studio-launch.log。")
}
