//go:build windows

// Windows hardware assessment, performed before Python/pip installation.
// Advisory thresholds are planning guidance, NOT model benchmark guarantees.
package main

import (
    "context"
    "encoding/json"
    "fmt"
    "os"
    "os/exec"
    "path/filepath"
    "runtime"
    "strconv"
    "strings"
    "syscall"
    "time"
    "unsafe"
)

type machineReport struct {
    Version int `json:"version"`
    CheckedAt string `json:"checked_at"`
    CPUName string `json:"cpu_name"`
    PhysicalCores int `json:"physical_cores"`
    LogicalCores int `json:"logical_cores"`
    RAMGB float64 `json:"ram_gb"`
    GPU []string `json:"gpu_names"`
    NVIDIAName string `json:"nvidia_name"`
    NVIDIAVRAMGB float64 `json:"nvidia_vram_gb"`
    FreeDiskGB float64 `json:"free_disk_gb"`
    BasicReady bool `json:"basic_ready"`
    BasicRecommended bool `json:"basic_recommended"`
    AdvancedTier string `json:"advanced_tier"`
    Notes []string `json:"notes"`
}

type memStatus struct {
    Length uint32
    Load uint32
    TotalPhys uint64
    AvailPhys uint64
    TotalPage uint64
    AvailPage uint64
    TotalVirtual uint64
    AvailVirtual uint64
    AvailExtendedVirtual uint64
}

type psInfo struct {
    Name string `json:"cpu_name"`
    Physical int `json:"physical_cores"`
    GPUs []string `json:"gpu_names"`
}

func memoryGB() float64 {
    kernel:=syscall.NewLazyDLL("kernel32.dll").NewProc("GlobalMemoryStatusEx")
    var m memStatus
    m.Length=uint32(unsafe.Sizeof(m))
    ok,_,_:=kernel.Call(uintptr(unsafe.Pointer(&m)))
    if ok==0{return 0}
    return float64(m.TotalPhys)/1073741824.0
}

func freeDiskGB(path string) float64 {
    dll:=syscall.NewLazyDLL("kernel32.dll").NewProc("GetDiskFreeSpaceExW")
    p,err:=syscall.UTF16PtrFromString(path)
    if err!=nil{return 0}
    var available,total,free uint64
    ok,_,_:=dll.Call(uintptr(unsafe.Pointer(p)),uintptr(unsafe.Pointer(&available)),
        uintptr(unsafe.Pointer(&total)),uintptr(unsafe.Pointer(&free)))
    if ok==0{return 0}
    return float64(available)/1073741824.0
}

func gpuAndCPU(base string, report *machineReport) {
    ctx,cancel:=context.WithTimeout(context.Background(),12*time.Second)
    defer cancel()
    // Get-CimInstance is Windows built-in; this does not download or install any software.
    script:=`[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; `+
        `$c=Get-CimInstance Win32_Processor -ErrorAction Stop | Select-Object -First 1; `+
        `$g=@(Get-CimInstance Win32_VideoController -ErrorAction Stop | ForEach-Object { $_.Name }); `+
        `[pscustomobject]@{cpu_name=[string]$c.Name;physical_cores=[int]$c.NumberOfCores;gpu_names=@($g)} | ConvertTo-Json -Compress`
    cmd:=exec.CommandContext(ctx,"powershell.exe","-NoProfile","-NonInteractive","-Command",script)
    cmd.SysProcAttr=&syscall.SysProcAttr{HideWindow:true}
    cmd.Dir=base
    out,err:=cmd.Output()
    if err==nil {
        var info psInfo
        if json.Unmarshal(out,&info)==nil {
            report.CPUName=strings.TrimSpace(info.Name)
            report.PhysicalCores=info.Physical
            for _,g:=range info.GPUs {
                if strings.TrimSpace(g)!="" {report.GPU=append(report.GPU,strings.TrimSpace(g))}
            }
        }
    }
    if report.CPUName=="" { report.CPUName="Windows CPU（型號尚未讀取）" }
    if len(report.GPU)==0 { report.Notes=append(report.Notes,"未取得顯示卡列表，可能是偵測受限；並非保證沒有 GPU") }
    ctx2,cancel2:=context.WithTimeout(context.Background(),4*time.Second)
    defer cancel2()
    nv:=exec.CommandContext(ctx2,"nvidia-smi","--query-gpu=name,memory.total",
        "--format=csv,noheader,nounits")
    nv.SysProcAttr=&syscall.SysProcAttr{HideWindow:true}
    raw,e:=nv.Output()
    if e==nil {
        first:=strings.SplitN(strings.TrimSpace(string(raw)),"\\n",2)[0]
        parts:=strings.SplitN(first,",",2)
        if len(parts)==2 {
            v,e2:=strconv.ParseFloat(strings.TrimSpace(parts[1]),64)
            if e2==nil && v>0 {
                report.NVIDIAName=strings.TrimSpace(parts[0])
                report.NVIDIAVRAMGB=v/1024.0
                if len(report.GPU)==0 { report.GPU=[]string{report.NVIDIAName} }
            }
        }
    }
}

func assessHardware(base string) machineReport {
    r:=machineReport{
        Version:1,
        CheckedAt:time.Now().Format(time.RFC3339),
        LogicalCores:runtime.NumCPU(),
        RAMGB:memoryGB(),
        FreeDiskGB:freeDiskGB(base),
        GPU:[]string{},
        Notes:[]string{},
        AdvancedTier:"unknown",
    }
    gpuAndCPU(base,&r)
    if r.RAMGB==0 {r.Notes=append(r.Notes,"無法讀取 RAM；請手動確認容量")}
    if r.FreeDiskGB==0 {r.Notes=append(r.Notes,"無法讀取磁碟可用容量")}
    r.BasicReady=r.LogicalCores>=2 && (r.RAMGB==0||r.RAMGB>=4) &&
        (r.FreeDiskGB==0||r.FreeDiskGB>=2)
    r.BasicRecommended=r.LogicalCores>=4 && r.RAMGB>=8 && r.FreeDiskGB>=5
    switch {
    case r.NVIDIAVRAMGB>=24 && r.RAMGB>=16 && r.FreeDiskGB>=35:
        r.AdvancedTier="high"
    case r.NVIDIAVRAMGB>=8 && r.RAMGB>=16 && r.FreeDiskGB>=20:
        r.AdvancedTier="medium"
    case len(r.GPU)>0 && r.NVIDIAVRAMGB==0:
        r.AdvancedTier="gpu-unverified"
    default:
        r.AdvancedTier="basic-only"
    }
    // No GPU is required for basic PDF / Edge-TTS / WebM operations.
    if r.LogicalCores<4 {r.Notes=append(r.Notes,"CPU 邏輯核心少於 4：建議降低 PDF 頁數及輸出解析度")}
    if r.RAMGB>0 && r.RAMGB<8 {r.Notes=append(r.Notes,"RAM 少於 8 GB：不建議同時執行多個 AI 模型")}
    if r.FreeDiskGB>0 && r.FreeDiskGB<10 {r.Notes=append(r.Notes,"磁碟剩餘少於 10 GB：不宜下載大型模型")}
    return r
}

func hardwareMessage(r machineReport) string {
    gpu:="尚未確認具可用的 NVIDIA 加速 GPU"
    if len(r.GPU)>0 {gpu=strings.Join(r.GPU,", ")}
    if r.NVIDIAVRAMGB>0 {gpu+=fmt.Sprintf("（NVIDIA VRAM %.1f GB）",r.NVIDIAVRAMGB)}
    cpu:=fmt.Sprintf("%d 邏輯核心",r.LogicalCores)
    if r.PhysicalCores>0 {cpu=fmt.Sprintf("%d 實體 / %d 邏輯核心",r.PhysicalCores,r.LogicalCores)}
    normal:="可使用基本 PDF 製片"
    if !r.BasicReady {normal="基本製片規格低於建議最低門檻，可能無法順利執行"}
    detail:="重量級 AI 模型不建議啟用（仍可使用基本配音及 PDF 製片）"
    if r.AdvancedTier=="high" {detail="可能適合高階本機影片生成；仍須驗證 CUDA、模型與推論"}
    if r.AdvancedTier=="medium" {detail="可嘗試部分低 VRAM AI 模型；需實際驗證"}
    if r.AdvancedTier=="gpu-unverified" {detail="偵測到顯示卡，但加速能力／VRAM 尚未核實"}
    result:=fmt.Sprintf("CPU：%s
記憶體：%.1f GB
顯示卡：%s
所在磁碟剩餘：%.1f GB

"+
        "基本功能：%s
進階 AI：%s

"+
        "此為首次啟動硬體預檢，非模型速度保證。
是否繼續啟動？",
        cpu,r.RAMGB,gpu,r.FreeDiskGB,normal,detail)
    if len(r.Notes)>0 {
        result=strings.Replace(result,"此為首次啟動硬體預檢",strings.Join(r.Notes,"
")+"

此為硬體預檢",1)
    }
    return result
}

func runHardwarePreflight(base string) bool {
    reportPath:=filepath.Join(base,"pdf-ai-video-studio","local-service",".hardware-report.json")
    r:=assessHardware(base)
    out,e:=json.MarshalIndent(r,"","  ")
    if e==nil {
        // No identity, passwords, document names or personal files are recorded.
        _=os.WriteFile(reportPath,out,0600)
    }
    flags:=uintptr(0x04|0x40) // MB_YESNO | MB_ICONINFORMATION
    if !r.BasicReady {flags=0x04|0x30} // MB_YESNO | warning
    return dialog("PDF 智慧影音製作系統｜電腦硬體檢查",hardwareMessage(r),flags)==6
}
