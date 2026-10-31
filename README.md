# 작지 BOM 검증 앱

작업지시서를 폰 카메라로 찍어 품번·구성품 번호를 읽고, 폰에 불러온 BOM 데이터와 대조해 틀린 항목에 빨간 줄을 긋는 웹앱(PWA)입니다.

- 글자 인식(Tesseract)과 BOM 대조는 모두 폰 안에서 처리합니다. 사진과 BOM 데이터는 외부로 전송하지 않습니다.
- BOM 데이터는 이 저장소에 없습니다. 앱의 [BOM 데이터 불러오기]로 폰에 넣어 사용합니다.
- 사용 라이브러리: tesseract.js 5.1.1 · tesseract.js-core · 영어 학습 데이터(Apache-2.0), SheetJS xlsx 0.18.5 mini(Apache-2.0)
