/**
 * 4D클린 서버 마스터 스크립트 v2.0
 * 구글 드라이브 지정 폴더 고정 및 첨부사진 가로 배열 로직 탑재
 */

// [수정 3] 성도님이 지정하신 루트 폴더 ID로 강제 고정
var BASE_FOLDER_ID = "1lFsgupn4XZvaiTPa7BUR-lMOStJZD4fe";

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "정상적인 웹앱 요청이 아닙니다." })).setMimeType(ContentService.MimeType.JSON);
    }

    var data = JSON.parse(e.postData.contents);
    var action = data.action;
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. 단건 사진 업로드 (물리적 파일 저장)
    if (action === "UPLOAD_SINGLE_PHOTO") {
      var folder = getFolder(data.yearMonthFolder);
      var blob = Utilities.newBlob(Utilities.base64Decode(data.fileData), 'image/jpeg', data.fileName);
      var newFile = folder.createFile(blob);
      
      return ContentService.createTextOutput(JSON.stringify({ 
        status: "success",
        fileName: data.fileName,
        url: newFile.getUrl()
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // 2. 최종 텍스트 데이터 및 구글 시트 저장 로직
    if (action === "SUBMIT_TEXT_ONLY") {
      var sheet = ss.getSheetByName("작업일지") || ss.insertSheet("작업일지");
      
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["작업일자", "시작시간", "종료시간", "소요시간", "건물명", "체크리스트(완료여부)", "날씨", "외부온도", "외부습도", "내부온도", "내부습도", "고객요청사항", "작업메모", "첨부사진목록", "작업자", "기록시간"]);
        sheet.getRange(1, 1, 1, 16).setBackground("#4f46e5").setFontColor("white").setFontWeight("bold");
        sheet.setFrozenRows(1);
      }
      
      var folder = getFolder(data.workDate.substring(0,7).replace('-',''));
      
      // [수정 2] 첨부사진목록을 세로(\n)가 아닌 가로( / )로 배열하도록 로직 전면 개편
      var photoCellStr = "";
      var links = [];
      var photoKeys = Object.keys(data.uploadedPhotos);
      
      for (var i = 0; i < photoKeys.length; i++) {
        var key = photoKeys[i];
        var fileData = data.uploadedPhotos[key];
        var fileName = fileData.name || fileData;
        var fileUrl = "파일을 찾을 수 없음";
        
        var files = folder.getFilesByName(fileName);
        if (files.hasNext()) {
          fileUrl = files.next().getUrl();
        } else if (fileData.url) {
          fileUrl = fileData.url;
        }

        var startIdx = photoCellStr.length;
        photoCellStr += fileName;
        var endIdx = photoCellStr.length;
        links.push({start: startIdx, end: endIdx, url: fileUrl});
        
        // 마지막 항목이 아니면 슬래시(/)로 가로 이어붙이기
        if (i < photoKeys.length - 1) {
          photoCellStr += " / "; 
        }
      }

      var checklistStr = "";
      if (data.checklist && Array.isArray(data.checklist)) {
         checklistStr = data.checklist.map(function(c) { return c.item + "(" + c.checked + ")"; }).join(" / ");
      }
      
      // 16개 열 순서 엄격 준수 데이터 적재
      sheet.appendRow([
        data.workDate,
        data.startTime || "",
        data.endTime || "",
        data.workDuration || "",
        data.building,
        checklistStr,
        data.weather || "미수집",
        data.extTemp ? data.extTemp + "°C" : "미수집",
        data.extHumid ? data.extHumid + "%" : "미수집",
        data.interiorTemp ? data.interiorTemp + "°C" : "미입력",
        data.interiorHumid ? data.interiorHumid + "%" : "미입력",
        data.customerReq || "",
        data.memo || data.workMemo || "",
        "", // 14번째 열 (아래에서 하이퍼링크 덮어씌움)
        data.worker,
        new Date()
      ]);

      if (photoCellStr !== "") {
        var photoCell = sheet.getRange(sheet.getLastRow(), 14);
        var richText = SpreadsheetApp.newRichTextValue().setText(photoCellStr);
        links.forEach(function(l) {
          if (l.url !== "파일을 찾을 수 없음" && l.url.indexOf("http") === 0) {
            richText.setLinkUrl(l.start, l.end, l.url);
          }
        });
        photoCell.setRichTextValue(richText.build());
      }
      
      return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "SAVE_RULES") {
      var ruleSheet = ss.getSheetByName("규칙설정") || ss.insertSheet("규칙설정");
      ruleSheet.getRange(1, 1).setValue(JSON.stringify(data.rules));
      return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "GET_RULES") {
      var ruleSheet = ss.getSheetByName("규칙설정") || ss.insertSheet("규칙설정");
      var rawData = ruleSheet.getRange(1, 1).getValue();
      if (!rawData || rawData === "") {
        return ContentService.createTextOutput(JSON.stringify({ status: "success", data: null })).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({ status: "success", data: JSON.parse(rawData) })).setMimeType(ContentService.MimeType.JSON);
    }

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

// [수정 3] 지정된 ID 기반 폴더 생성 로직으로 교체
function getFolder(folderName) {
  var parent = DriveApp.getFolderById(BASE_FOLDER_ID);
  var targets = parent.getFoldersByName(folderName);
  return targets.hasNext() ? targets.next() : parent.createFolder(folderName);
}