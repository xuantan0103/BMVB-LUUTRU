
import { GoogleGenAI, Type } from "@google/genai";
import { ExtractedDocument } from "../types";
import { PDFDocument } from "pdf-lib";

const API_LIMIT_BYTES = 30 * 1024 * 1024; 
const PAGES_PER_CHUNK = 15; 
const IMAGES_PER_CHUNK = 10;

const uint8ArrayToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Lỗi khi đọc file."));
  });
};

const documentSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      docType: {
        type: Type.STRING,
        description: "Loại văn bản (Ví dụ tiếng Việt: Quyết định, Thông báo, Công văn, Kế hoạch... Hoặc tiếng Pháp GIỮ NGUYÊN NẾU CÓ: Arrêté, Décision, Circulaire, Rapport, Lettre, Télégramme, Note, Ordre...).",
      },
      symbol: {
        type: Type.STRING,
        description: "Số ký hiệu văn bản. Nếu không có để trống.",
      },
      date: {
        type: Type.STRING,
        description: "Ngày tháng văn bản (định dạng dd/mm/yyyy).",
      },
      summary: {
        type: Type.STRING,
        description: "Trích yếu nội dung tiếp nối sau tên loại văn bản. TUYỆT ĐỐI KHÔNG BỎ SÓT TÊN CÁ NHÂN TRONG VĂN BẢN (Ví dụ: tên cá nhân được hưởng, được cấp sổ, khen thưởng, bổ nhiệm, điều động...). TUYỆT ĐỐI GIỮ NGUYÊN NẾU LÀ TIẾNG PHÁP.",
      },
      authority: {
        type: Type.STRING,
        description: "Cơ quan ban hành văn bản trực tiếp. TUYỆT ĐỐI GIỮ NGUYÊN NẾU LÀ TIẾNG PHÁP.",
      },
      startPage: {
        type: Type.STRING,
        description: "Số trang bắt đầu (là số nằm phía bên góc phải văn bản, được viết bằng bút chì). ĐỊNH DẠNG: Nếu số từ 1 đến 9, phải thêm số 0 ở trước (Ví dụ: '01', '02').",
      }
    },
    required: ["docType", "symbol", "date", "summary", "authority", "startPage"],
  },
};

const systemInstruction = `Bạn là chuyên gia văn thư lưu trữ và chuyên gia giải mã văn bản lịch sử. Nhiệm vụ của bạn là bóc tách TOÀN BỘ các văn bản có trong tệp tài liệu (PDF hoặc hình ảnh đính kèm).

QUY TẮC NGHIÊM NGẶT VỀ GIẢI MÃ VĂN BẢN (ĐẶC BIỆT QUAN TRỌNG):

1. QUY TẮC VỀ VĂN BẢN TIẾNG PHÁP (MỚI - BẮT BUỘC):
   - GIỮ NGUYÊN VĂN BẢN TIẾNG PHÁP, TUYỆT ĐỐI KHÔNG DỊCH SANG TIẾNG VIỆT HOẶC BẤT KỲ NGÔN NGỮ NÀO KHÁC.
   - Nếu văn bản (hoặc một phần văn bản) được viết bằng tiếng Pháp, GIỮ NGUYÊN TOÀN BỘ VĂN BẢN TIẾNG PHÁP trong các trường: Tên loại văn bản (docType), Trích yếu nội dung (summary), Cơ quan ban hành (authority), Số ký hiệu (symbol).
   - Ví dụ: Trích yếu "Au sujet de la réorganisation du service des douanes" -> GIỮ NGUYÊN "au sujet de la réorganisation du service des douanes", KHÔNG DỊCH THÀNH "về việc tổ chức lại cơ quan hải quan".
   - Ví dụ: Tên loại văn bản tiếng Pháp "Arrêté", "Décision", "Circulaire", "Rapport", "Lettre" -> GIỮ NGUYÊN, không dịch thành "Nghị định", "Quyết định", "Thông tư", "Báo cáo", "Thư".
   - Ví dụ: Cơ quan ban hành "Résidence Supérieure au Tonkin", "Gouvernement Général de l'Indochine", "Mairie de Hà Nội" -> GIỮ NGUYÊN.

2. ĐỐI VỚI VĂN BẢN ĐÁNH MÁY KIỂU CŨ (MÁY OLIVETTI, HERMES) VÀ CÔNG ĐIỆN BẰNG TIẾNG VIỆT:
   - Các văn bản này thường không có dấu hoặc sử dụng quy ước Telex cổ điển (Ví dụ: 'as' -> 'á', 'af' -> 'à', 'ax' -> 'ã', 'aj' -> 'ạ', 'ar' -> 'ả', 'ee' -> 'ê', 'oo' -> 'ô', 'aa' -> 'â', 'dd' -> 'đ', 'uw' -> 'ư', 'ow' -> 'ơ').
   - Bạn PHẢI dịch thuật, giải mã và chuyển đổi các ký tự Telex sang tiếng Việt có dấu một cách CHÍNH XÁC NHẤT.
   - Đảm bảo nội dung trích xuất hoàn toàn là tiếng Việt chuẩn, tự nhiên, không còn các ký tự Telex thừa hay lỗi font.
   - Nếu văn bản tiếng Việt hoàn toàn không có dấu (không dùng Telex), bạn phải dựa vào ngữ cảnh để thêm dấu tiếng Việt một cách chính xác nhất.

3. TÓM TẮT TRÍCH YẾU (Summary):
   - Phải tóm tắt rõ ràng, ngắn gọn nhưng PHẢI ĐẦY ĐỦ NỘI DUNG cốt lõi.
   - TUYỆT ĐỐI KHÔNG BỎ SÓT TÊN CÁ NHÂN TRONG VĂN BẢN (ĐẶC BIỆT CHÚ Ý): Nếu văn bản đề cập đến tên cá nhân đối tượng (Ví dụ: cấp sổ ưu đãi giáo dục, đào tạo cho em Nguyễn Văn A; khen thưởng ông Trần Văn B; trợ cấp cho bà Lê Thị C; điều động, bổ nhiệm ông Phạm Văn D...), bạn PHẢI BẮT BUỘC ghi đầy đủ họ và tên cá nhân đó trong phần trích yếu. TUYỆT ĐỐI KHÔNG ĐƯỢC TỰ Ý CẮT BỎ TÊN CÁ NHÂN.
   - Trích yếu phải bám sát nội dung trong văn bản, phản ánh đúng tinh thần và các thông tin quan trọng nhất.
   - TUYỆT ĐỐI KHÔNG lặp lại tên loại văn bản (docType) trong phần trích yếu.
   - Bắt đầu trích yếu bằng chữ thường (Ví dụ: "về việc...", "kết quả...", "au sujet de...", "sur...", "relative à..."). CHỈ viết hoa nếu là tên riêng cá nhân, tổ chức hoặc địa danh.

4. Cơ quan ban hành (authority): 
   - KHÔNG viết in hoa tất cả các chữ cái (trừ các từ viết tắt).
   - CHỈ viết hoa chữ cái đầu tiên và các từ là tên riêng.
   - Đối với BẢN TỰ KIỂM ĐIỂM, SƠ YẾU LÝ LỊCH...: Cơ quan ban hành chính là Tên cá nhân thực hiện văn bản.

5. Số ký hiệu (symbol): 
   - CHỈ LẤY NẾU CÓ ĐẦY ĐỦ CẢ CHỮ (VĂN BẢN/KÝ HIỆU) VÀ SỐ (Ví dụ: '12/QĐ-UBND', '25-NQ/TW', 'N° 1245/CP', '45/TB'). 
   - NẾU SỐ KÝ HIỆU CHỈ CÓ SỐ (Ví dụ: '12', '123', '2024', '01/02') HOẶC CHỈ CÓ CHỮ MÀ KHÔNG CÓ SỐ THÌ BẮT BUỘC ĐỂ TRỐNG (symbol = ''). 
   - KHÔNG THÊM dấu nháy đơn '.

6. Ngày tháng: Định dạng dd/m/yyyy hoặc dd/mm/yyyy. QUAN TRỌNG: Tháng 1 và tháng 2 BẮT BUỘC thêm số 0 ở trước (Ví dụ: '01', '02'). Từ tháng 3 đến tháng 9 KHÔNG THÊM số 0 ở trước (Ví dụ: '3', '4', '5', '6', '7', '8', '9'). Tháng 10, 11, 12 để hai chữ số ('10', '11', '12').
7. Số trang bắt đầu: Trích xuất số bút chì ghi ở góc trên bên phải trang đầu mỗi văn bản. ĐỊNH DẠNG: Nếu số từ 1 đến 9, phải thêm số 0 ở trước (Ví dụ: '01', '02'). Nếu không có số bút chì trên ảnh/văn bản, đánh số theo thứ tự tài liệu ('01', '02'...).

TUYỆT ĐỐI KHÔNG BỎ SÓT BẤT KỲ VĂN BẢN NÀO.`;

interface ContentPart {
  inlineData: {
    mimeType: string;
    data: string;
  };
}

const processParts = async (ai: GoogleGenAI, parts: ContentPart[]): Promise<ExtractedDocument[]> => {
  const makeRequest = async (retries = 2): Promise<ExtractedDocument[]> => {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: [
          {
            parts: [
              ...parts,
              { text: "Phân tích và trích xuất danh sách văn bản sang JSON theo đúng schema và hướng dẫn hệ thống. CHÚ Ý: TUYỆT ĐỐI KHÔNG BỎ SÓT TÊN CÁ NHÂN trong trích yếu nội dung văn bản; GIỮ NGUYÊN VĂN BẢN TIẾNG PHÁP, KHÔNG DỊCH SANG TIẾNG VIỆT." }
            ],
          },
        ],
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: documentSchema,
        },
      });

      const result = response.text;
      if (!result) return [];
      
      const cleanJson = result.replace(/```json/g, '').replace(/```/g, '').trim();
      const rawData: ExtractedDocument[] = JSON.parse(cleanJson);

      // Hậu xử lý
      rawData.forEach(doc => {
        if (doc.startPage && /^\d$/.test(doc.startPage.toString().trim())) {
          doc.startPage = `0${doc.startPage.toString().trim()}`;
        }
        
        if (doc.docType && doc.summary) {
          let summary = doc.summary.trim();
          const docTypeLower = doc.docType.toLowerCase().trim();
          
          if (summary.toLowerCase().startsWith(docTypeLower)) {
            summary = summary.substring(docTypeLower.length).trim();
          }
          
          if (summary.length > 0) {
            // Lowercase first letter unless starting with a proper name (e.g. "Nguyễn Văn A...")
            const words = summary.split(/\s+/);
            const firstWord = words[0] || "";
            const secondWord = words[1] || "";
            const isFirstCap = /^[A-Z\u00C0-\u024F\u1EA0-\u1EF9]/.test(firstWord);
            const isSecondCap = /^[A-Z\u00C0-\u024F\u1EA0-\u1EF9]/.test(secondWord);

            if (!(isFirstCap && isSecondCap)) {
              summary = summary.charAt(0).toLowerCase() + summary.slice(1);
            }
          }
          
          doc.summary = summary;
        }
      });

      return rawData;
    } catch (e: any) {
      if (retries > 0 && (e.message?.includes('500') || e.status === 500 || e.message?.includes('Internal error'))) {
        console.warn(`Gemini 500 error, retrying... (${retries} attempts left)`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return makeRequest(retries - 1);
      }
      console.error("Gemini processing error:", e);
      throw e;
    }
  };

  return makeRequest();
};

const filterValidSymbol = (rawSymbol: string | undefined): string => {
  if (!rawSymbol) return "";
  const trimmed = rawSymbol.trim();
  if (!trimmed) return "";

  const hasDigit = /\d/.test(trimmed);
  const hasLetter = /[a-zA-Z\u00C0-\u024F\u1EA0-\u1EF9]/i.test(trimmed);

  // Must contain BOTH text/letters and digits
  if (hasDigit && hasLetter) {
    return trimmed;
  }
  return "";
};

const formatAndCalculateRanges = (allResults: ExtractedDocument[]): ExtractedDocument[] => {
  return allResults.map((doc, index, array) => {
    const nextDoc = array[index + 1];
    const startPage = doc.startPage;
    let endPage: number | null = null;
    
    if (nextDoc) {
      endPage = Number(nextDoc.startPage) - 1;
    }

    let displayRange = `'${startPage}`;
    if (endPage !== null && !isNaN(endPage) && endPage > Number(startPage)) {
      const endPageStr = endPage < 10 ? `0${endPage}` : `${endPage}`;
      displayRange = `'${startPage}-${endPageStr}`;
    }

    let formattedDate = doc.date ? (doc.date.startsWith("'") ? doc.date.substring(1) : doc.date) : "";
    if (formattedDate) {
      const parts = formattedDate.split('/');
      if (parts.length === 3) {
        let [day, month, year] = parts;
        const monthNum = parseInt(month, 10);
        if (!isNaN(monthNum)) {
          if (monthNum === 1 || monthNum === 2) {
            month = `0${monthNum}`;
          } else if (monthNum >= 3 && monthNum <= 9) {
            month = `${monthNum}`;
          } else if (monthNum >= 10 && monthNum <= 12) {
            month = `${monthNum}`;
          }
          formattedDate = `${day}/${month}/${year}`;
        }
      }
      formattedDate = `'${formattedDate}`;
    }

    return {
      ...doc,
      symbol: filterValidSymbol(doc.symbol),
      date: formattedDate,
      pageRange: displayRange
    };
  });
};

export const extractDataFromFiles = async (files: File[]): Promise<ExtractedDocument[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  let allResults: ExtractedDocument[] = [];

  const pdfFiles = files.filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
  const imageFiles = files.filter(f => f.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|tiff)$/i.test(f.name));

  // 1. Xử lý các tệp PDF
  for (const pdfFile of pdfFiles) {
    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdfDoc = await PDFDocument.load(arrayBuffer);
    const totalPdfPages = pdfDoc.getPageCount();

    if (pdfFile.size <= API_LIMIT_BYTES) {
      const base64Data = await fileToBase64(pdfFile);
      const pdfResults = await processParts(ai, [{ inlineData: { mimeType: "application/pdf", data: base64Data } }]);
      allResults.push(...pdfResults);
    } else {
      for (let i = 0; i < totalPdfPages; i += PAGES_PER_CHUNK) {
        const newDoc = await PDFDocument.create();
        const end = Math.min(i + PAGES_PER_CHUNK, totalPdfPages);
        const pagesToCopy = Array.from({ length: end - i }, (_, k) => i + k);
        const copiedPages = await newDoc.copyPages(pdfDoc, pagesToCopy);
        copiedPages.forEach(page => newDoc.addPage(page));
        const pdfBytes = await newDoc.save();
        const base64Chunk = uint8ArrayToBase64(pdfBytes);
        const chunkResults = await processParts(ai, [{ inlineData: { mimeType: "application/pdf", data: base64Chunk } }]);
        allResults.push(...chunkResults);
      }
    }
  }

  // 2. Xử lý các tệp ảnh (Hình ảnh đính kèm / nhiều ảnh)
  if (imageFiles.length > 0) {
    for (let i = 0; i < imageFiles.length; i += IMAGES_PER_CHUNK) {
      const chunk = imageFiles.slice(i, i + IMAGES_PER_CHUNK);
      const imageParts: ContentPart[] = [];

      for (const imgFile of chunk) {
        const base64 = await fileToBase64(imgFile);
        const mimeType = imgFile.type || 'image/jpeg';
        imageParts.push({ inlineData: { mimeType, data: base64 } });
      }

      if (imageParts.length > 0) {
        const imgResults = await processParts(ai, imageParts);
        allResults.push(...imgResults);
      }
    }
  }

  return formatAndCalculateRanges(allResults);
};

export const extractDataFromPdf = async (file: File): Promise<ExtractedDocument[]> => {
  return extractDataFromFiles([file]);
};

