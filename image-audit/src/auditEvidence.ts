/**
 * Conservative cross-source photo reuse triage (NOT a legal risk score).
 * DINOv2 cosine similarity is a semantic descriptor, not a duplicate probability.
 * A second pixel/layout indicator helps avoid rejecting highly similar images at
 * 80-90% DINOv2 scores. Labels never assert separate photos or wrongdoing.
 */
export type EvidenceLevel = 'high' | 'review' | 'undetermined';
export interface PhotoEvidence { dino: number | null; pixel: number; }
export interface EvidenceAssessment {
  level: EvidenceLevel;
  heading: string;
  rationale: string;
}
export function assessPhotoEvidence(v: PhotoEvidence): EvidenceAssessment {
  const d = v.dino, p = v.pixel;
  if (d === null) {
    if (p >= 91) return {level:'review',heading:'需優先複核（僅像素指標）',rationale:'像素接近，但本次缺少 DINOv2 特徵與幾何匹配資料，可能是相似場景或同源影像。'};
    return {level:'undetermined',heading:'證據不足，待人工核對',rationale:'沒有 DINOv2 特徵，像素相似度亦不足以直接確認同源或不同源。'};
  }
  if (d >= 97 && p >= 90) return {level:'high',heading:'高度疑似相同影像來源',rationale:'語意特徵及像素分佈皆非常接近，可能是相同照片的轉存、縮放或重新壓縮。'};
  if ((d >= 84 && p >= 88) || (d >= 93 && p >= 70)) {
    return {level:'high',heading:'高度疑似重複來源，應優先查證',rationale:'DINOv2 特徵與像素證據共同支持畫面接近；單看 DINOv2 未達 90% 不應直接否定同源，差異可能來自裁切、構圖邊界、曝光或轉存。'};
  }
  if (d >= 80 || (d >= 75 && p >= 85)) {
    return {level:'review',heading:'具有同源嫌疑，建議人工複核',rationale:'兩項特徵證據未完全一致，可能有大幅裁切、位置變化、不同拍攝時間或相似場景；目前不能直接判成不同照片。'};
  }
  return {level:'undetermined',heading:'證據不足，無法判定是否同源',rationale:'目前特徵未提供充分的重複影像證據，但不能據此證明不同來源或排除工程違規。'};
}
export function buildAuditRule(v: PhotoEvidence): string {
 const a=assessPhotoEvidence(v);
 const d=v.dino==null?'未取得':' '+v.dino.toFixed(1)+'%';
 const p=v.pixel.toFixed(2)+'%';
 return '1. 差異度說明：DINOv2 特徵相似度'+d+'；像素相似度 '+p+'。'+a.rationale+
 '\n2. 查核研判：'+a.heading+'。兩張影像的相似程度不等於違規機率，現有指標也未完成原始檔或幾何特徵點確認。'+
 '\n3. 建議查證：取得原始照片與 EXIF，核對照片所屬批次、拍攝時間、位置、施工日誌、估驗數量及驗收資料；如屬同一張照片跨期使用，再評估是否涉及重複佐證或計價異常。';
}
