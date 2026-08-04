# AI Education Room MVP PRD

## 1. Product Summary

회사 내부 AI교육을 운영하기 위한 가벼운 교육 커뮤니티 앱을 만든다. 슬랙/네이트온 팀룸처럼 범용 채팅 중심이 아니라, 운영자가 올리는 교육 공지와 퀘스트를 참가자가 확인하고, 스티커/댓글로 반응하며, 자료와 질문을 한 곳에 모으는 것이 목적이다.

첫 버전은 웹앱으로 만들고, 이후 Electron 또는 Tauri로 데스크톱 앱처럼 배포할 수 있게 한다.

## 2. Problem

현재 네이트온 팀룸은 교육 운영에 불편하다.

- 영상 업로드/공유가 어렵다.
- 공지 확인 여부를 한눈에 보기 어렵다.
- 참가자 반응이 흩어진다.
- 질문, 답변, 자료가 섞여 검색이 어렵다.
- 슬랙은 범용 협업툴이라 교육용 운영 흐름에 맞지 않는다.

## 3. Goals

- 운영자가 교육 공지와 퀘스트를 쉽게 올린다.
- 참가자는 글을 보고 `봤어요` 스티커나 댓글로 반응한다.
- 영상과 첨부파일은 링크 기반으로 붙일 수 있다.
- 자료실에 참가자들이 유용한 자료를 공유한다.
- 질문 게시판에서 질문/답변/해결 여부를 관리한다.
- 가끔 경연형 퀘스트를 열어 참가자가 링크나 파일을 제출한다.
- 운영자는 누가 공지/퀘스트를 확인했는지 볼 수 있다.

## 4. Non-Goals

MVP에서 하지 않는다.

- 슬랙식 실시간 채팅
- 복잡한 전자결재
- 운영자 승인 기반 과제 완료
- 자체 영상 인코딩/스트리밍 서버
- 화상회의
- 권한이 복잡한 조직도 연동
- 모바일 앱

## 5. Users

### 운영자

AI교육 담당자. 공지, 퀘스트, 영상 링크, 자료를 올리고 참가자 반응과 확인 현황을 본다.

### 참가자

회사 내부 교육 참가자. 공지/퀘스트를 보고 스티커, 댓글, 질문, 자료 공유, 경연 제출을 한다.

## 6. Core User Flows

### 공지 확인

1. 운영자가 공지 글을 작성한다.
2. 영상 링크 또는 첨부파일 링크를 붙인다.
3. 참가자가 글을 읽는다.
4. 참가자가 `봤어요` 스티커를 누른다.
5. 시스템은 해당 참가자를 확인 완료로 표시한다.

### 일반 퀘스트

1. 운영자가 퀘스트 글을 작성한다.
2. 참가자가 내용을 확인한다.
3. 참가자가 스티커 또는 댓글을 남긴다.
4. 시스템은 자동으로 완료 처리한다.

### 경연 퀘스트

1. 운영자가 경연 퀘스트를 작성한다.
2. 참가자가 제출 링크 또는 파일 링크를 등록한다.
3. 제출 즉시 참가자는 제출 완료 상태가 된다.
4. 운영자는 제출자 목록과 제출물을 확인한다.

### 자료 공유

1. 참가자가 자료 제목, 설명, 링크를 등록한다.
2. 다른 참가자가 자료를 열람한다.
3. 댓글로 보충 정보나 피드백을 남긴다.

### 질문 게시판

1. 참가자가 질문을 올린다.
2. 운영자 또는 다른 참가자가 답변한다.
3. 질문 작성자나 운영자가 해결 완료로 표시한다.

## 7. MVP Features

### 7.1 홈 피드

- 공지와 퀘스트를 최신순으로 표시한다.
- 유형 배지: `공지`, `퀘스트`, `경연`
- 각 글에 제목, 본문, 작성자, 작성일, 첨부 링크, 댓글 수, 확인 수를 표시한다.
- 필터: 전체, 공지, 퀘스트, 경연

### 7.2 글 작성

- 운영자 역할에서 글을 작성한다.
- 입력 필드:
  - 유형
  - 제목
  - 본문
  - 영상 링크
  - 첨부 링크
  - 마감일
- 경연 유형이면 제출 가능 상태가 된다.

### 7.3 스티커 반응

- 참가자는 글마다 `봤어요`, `완료`, `좋아요` 중 하나를 누를 수 있다.
- 일반 공지/퀘스트는 스티커를 누르면 자동 확인 완료 처리된다.
- 같은 참가자가 같은 글에 중복 확인되지 않는다.

### 7.4 댓글

- 모든 글에 댓글을 달 수 있다.
- 댓글은 작성자, 내용, 작성일을 가진다.
- 댓글 작성도 확인 활동으로 기록한다.

### 7.5 경연 제출

- 경연 글에는 제출 영역이 표시된다.
- 참가자는 제출 제목, 설명, 링크를 등록한다.
- 제출 즉시 제출 완료 처리된다.
- 운영자는 제출 목록을 볼 수 있다.

### 7.6 자료실

- 자료 제목, 설명, 링크, 태그를 등록한다.
- 자료 목록을 최신순으로 표시한다.
- 검색어로 제목/설명/태그를 찾는다.

### 7.7 질문 게시판

- 질문 제목, 본문을 등록한다.
- 답변 댓글을 달 수 있다.
- 질문 상태: `미해결`, `해결`
- 해결 상태 토글을 제공한다.

### 7.8 확인 현황

- 운영자 화면에서 참가자별 확인 수를 본다.
- 글별로 누가 확인했는지 본다.
- MVP에서는 수동 참가자 목록을 사용한다.

## 8. Media And File Strategy

MVP는 자체 파일 저장을 하지 않는다.

- 영상은 YouTube 일부 공개, Google Drive, Cloudflare Stream, Vimeo 링크를 붙인다.
- 개인 YouTube 계정 노출을 피하려면 회사 교육용 별도 Google/YouTube 계정을 쓴다.
- 첨부파일은 회사 Google Workspace 공유 드라이브 링크를 권장한다.
- 앱은 링크와 메타데이터만 저장한다.

## 9. Data Model

### User

- id
- name
- role: `admin` 또는 `member`

### Post

- id
- type: `notice`, `quest`, `contest`
- title
- body
- authorId
- videoUrl
- attachmentUrl
- dueDate
- createdAt

### Reaction

- id
- postId
- userId
- sticker: `seen`, `done`, `like`
- createdAt

### Comment

- id
- postId
- userId
- body
- createdAt

### Submission

- id
- postId
- userId
- title
- description
- url
- createdAt

### Resource

- id
- userId
- title
- description
- url
- tags
- createdAt

### Question

- id
- userId
- title
- body
- status: `open` 또는 `resolved`
- createdAt

### Answer

- id
- questionId
- userId
- body
- createdAt

## 10. Technical Direction

### MVP

- Static web app
- HTML, CSS, JavaScript
- localStorage persistence
- No backend
- No login integration
- Demo users selectable in UI

### Next Version

- React or Next.js frontend
- Postgres database
- Google Workspace login
- Google Drive API upload/link integration
- Admin/member permissions
- Electron or Tauri desktop package

## 11. Success Criteria

MVP is successful when:

- 운영자가 공지/퀘스트/경연 글을 만들 수 있다.
- 참가자가 스티커와 댓글로 확인 표시를 할 수 있다.
- 경연 제출 링크를 등록할 수 있다.
- 자료실에 자료 링크를 등록하고 검색할 수 있다.
- 질문을 올리고 답변을 달고 해결 처리할 수 있다.
- 새로고침 후에도 데이터가 유지된다.
- 코드 실행 없이 브라우저에서 바로 열 수 있다.

## 12. Open Decisions

- 회사 Google 계정 로그인 사용 여부
- Google Drive API 직접 업로드 지원 여부
- 그룹웨어 서버 배포 가능 여부
- 영상 저장소 최종 선택
- 데스크톱 패키징 방식: Electron 또는 Tauri
