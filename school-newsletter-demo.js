const crypto = require("crypto");
function demoReport() {
  return {
    id: crypto.randomUUID(),
    className: "Demo Grade 3",
    week: "Sample week",
    sendDate: "",
    history: [],
    approved: null,
    entries: [
      {
        subject: "ICT",
        english:
          "Next week in ICT, the children will explore file types and sizes. They will compare text notes, photos and videos, then explain why some files need more storage space.\n\nKey vocabulary\nFile: information saved on a computer.\nStorage: the space available for saved files.\n\nHow can you help at home?\nAsk your child which might need more space: a short note or a video. Encourage them to explain their choice.\n\nHomework\nReview the file-size examples shared in class.",
        vietnamese:
          "Tuần tới trong môn Tin học, các con sẽ tìm hiểu về các loại tệp và dung lượng tệp. Các con sẽ so sánh ghi chú, ảnh và video, sau đó giải thích vì sao một số tệp cần nhiều dung lượng lưu trữ hơn.\n\nTừ vựng chính\nTệp: thông tin được lưu trên máy tính.\nLưu trữ: không gian dành cho các tệp đã lưu.\n\nBa mẹ có thể hỗ trợ tại nhà như thế nào?\nHãy hỏi con một ghi chú ngắn hay một video cần nhiều dung lượng hơn và khuyến khích con giải thích.\n\nBài tập về nhà\nÔn lại các ví dụ về dung lượng tệp đã học trên lớp.",
        submitted: true,
        reviewed: true,
      },
      {
        subject: "Maths",
        english:
          'Next week in Maths, the children will compare and order whole numbers. They will use place-value charts and explain how the value of each digit helps them decide which number is larger.\n\nKey vocabulary\nDigit: one symbol used to write a number.\nPlace value: the value of a digit based on its position.\n\nHow can you help at home?\nChoose two numbers together. Ask, "Which is greater? How do you know?"\n\nHomework\nPractice comparing the example numbers from the lesson.',
        vietnamese:
          'Tuần tới trong môn Toán, các con sẽ so sánh và sắp xếp các số tự nhiên. Các con sẽ sử dụng bảng giá trị hàng để giải thích số nào lớn hơn.\n\nTừ vựng chính\nChữ số: một ký hiệu dùng để viết số.\nGiá trị theo hàng: giá trị của chữ số dựa vào vị trí của nó.\n\nBa mẹ có thể hỗ trợ tại nhà như thế nào?\nHãy cùng con chọn hai số và hỏi: "Số nào lớn hơn? Vì sao con biết?"\n\nBài tập về nhà\nLuyện tập so sánh các số trong bài học.',
        submitted: true,
        reviewed: false,
      },
      {
        subject: "Science",
        english:
          "Next week in Science, the children will investigate how light helps us see. They will compare objects in brighter and darker places and describe their observations.\n\nKey vocabulary\nLight source: something that produces light.\nObservation: something we notice carefully.\n\nHow can you help at home?\nLook for light sources around your home. Ask your child to explain how each one helps people see.",
        vietnamese:
          "Tuần tới trong môn Khoa học, các con sẽ tìm hiểu ánh sáng giúp chúng ta nhìn thấy như thế nào. Các con sẽ so sánh đồ vật ở nơi sáng và nơi tối hơn, rồi mô tả những điều quan sát được.\n\nTừ vựng chính\nNguồn sáng: vật tạo ra ánh sáng.\nQuan sát: những điều chúng ta chú ý nhận thấy.\n\nBa mẹ có thể hỗ trợ tại nhà như thế nào?\nHãy cùng con tìm các nguồn sáng trong nhà và hỏi mỗi nguồn sáng giúp mọi người nhìn thấy như thế nào.",
        submitted: false,
        reviewed: false,
      },
    ],
  };
}
module.exports = { demoReport };
