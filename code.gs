/**
 * 4D클린 서버 마스터 스크립트 v2.2
 * 구조화된 2-Depth 폴더 트리(건물명 > 년월) 적용 및 초고속 저장 엔진
 */

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
      // [핵심 1] 단건 업로드 시 건물명과 년월을 동시에 넘겨 2단계 폴더를 거치도록 수정
      var folder = getFolder(data.building, data.yearMonthFolder);
      var blob = Utilities.newBlob(Utilities.base64Decode(data.fileData), 'image/jpeg', data.fileName);
      var newFile = folder.createFile(blob);
      
      return ContentService.createTextOutput(JSON.stringify({ 
        status: "success",
        fileName: data.fileName,
        url: newFile.getUrl()
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // 2. 최종 텍스트 데이터 및 구글 시트 저장 로직 (초고속 병렬 처리)
    if (action === "SUBMIT_TEXT_ONLY") {
      var sheet = ss.getSheetByName("작업일지") || ss.insertSheet("작업일지");
      
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["작업일자", "시작시간", "종료시간", "소요시간", "건물명", "체크리스트(완료여부)", "날씨", "외부온도", "외부습도", "내부온도", "내부습도", "고객요청사항", "작업메모", "첨부사진목록", "작업자", "기록시간"]);
        sheet.getRange(1, 1, 1, 16).setBackground("#4f46e5").setFontColor("white").setFontWeight("bold");
        sheet.setFrozenRows(1);
      }
      
      var photoCellStr = "";
      var links = [];
      var photoKeys = Object.keys(data.uploadedPhotos);
      
      for (var i = 0; i < photoKeys.length; i++) {
        var key = photoKeys[i];
        var fileData = data.uploadedPhotos[key];
        var fileName = fileData.name || "이름없음";
        
        // 앱에서 넘겨준 URL 즉시 사용 (검색 시간 0초)
        var fileUrl = fileData.url; 
        
        // 방어 코드: URL 누락 시에만 백업으로 드라이브를 검색
        if (!fileUrl || fileUrl === "URL대기중" || fileUrl === "파일을 찾을 수 없음") {
          // [핵심 2] 방어 코드에서도 건물명 > 년월 2단계 폴더를 타고 들어가도록 수정
          var fallbackFolder = getFolder(data.building, data.workDate.substring(0,7).replace('-',''));
          var files = fallbackFolder.getFilesByName(fileName);
          if (files.hasNext()) {
            fileUrl = files.next().getUrl();
          } else {
            fileUrl = "파일을 찾을 수 없음";
          }
        }

        var startIdx = photoCellStr.length;
        photoCellStr += fileName;
        var endIdx = photoCellStr.length;
        links.push({start: startIdx, end: endIdx, url: fileUrl});
        
        if (i < photoKeys.length - 1) {
          photoCellStr += " / "; 
        }
      }

      var checklistStr = "";
      if (data.checklist && Array.isArray(data.checklist)) {
         checklistStr = data.checklist.map(function(c) { return c.item + "(" + c.checked + ")"; }).join(" / ");
      }
      
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
        "", // 하이퍼링크 덮어씌울 공간
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

// =================================================================
// [핵심 변경점] 2-Depth 폴더 생성/탐색 로직 (건물명 -> 년월 순차 확인)
// =================================================================
function getFolder(buildingName, yearMonthStr) {
  var root = DriveApp.getFolderById(BASE_FOLDER_ID);
  
  // 1단계: 건물명 폴더 탐색 (없으면 생성)
  var buildingFolders = root.getFoldersByName(buildingName);
  var buildingFolder;
  if (buildingFolders.hasNext()) {
    buildingFolder = buildingFolders.next();
  } else {
    buildingFolder = root.createFolder(buildingName);
  }
  
  // 2단계: 건물명 폴더 내부에 년월(예: 202604) 폴더 탐색 (없으면 생성)
  var yearMonthFolders = buildingFolder.getFoldersByName(yearMonthStr);
  if (yearMonthFolders.hasNext()) {
    return yearMonthFolders.next();
  } else {
    return buildingFolder.createFolder(yearMonthStr);
  }
}
