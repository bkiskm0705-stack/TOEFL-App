// Google Apps Script Web App URL
// このファイルは .gitignore に含まれるため、リポジトリにはコミットされません。
const CONFIG = {
    GAS_URL: "https://script.google.com/macros/s/AKfycbwyGBI8izGS4M-yu0U8U4JtLlKyXmOIGywSm7th67tdPHJi_8PbVAsFtxCt4LUtOwu5/exec",
    GOOGLE_CLOUD_API_KEY: "AIzaSyApXU0PcRuDn-KXW2ezGGj2754v_YGY7iY", // ステップ4で取得したキー（AIza...）
    // 高音質音声の設定 (Neural2)
    VOICE_SETTINGS: {
        MALE: "en-US-Neural2-J",   // おすすめ男性音声
        FEMALE: "en-US-Neural2-F"  // おすすめ女性音声
    }
};
