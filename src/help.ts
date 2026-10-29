import type {Localization} from './localization';

/** Product help is served locally and follows the saved interface language. */
export function installHelp(app:any,localization:Localization){
  app.get('/api/local/help',async(request:any,reply:any)=>{
    const ja=localization.resolve(request.headers?.['accept-language'])==='ja';
    const sections=ja?[
      ['models','外部LLMの接続','設定の「接続」を開き、接続名、APIベースURL、APIキーを入力します。Chat CompletionsかResponsesを選んでください。URLには提供元の指定する/v1などのパスを含めます。',
        '「モデル一覧を取得」でAPIの/modelsを確認できます。未対応のAPIでは「モデルIDを手動登録」を選び、正確なIDを1行ずつ入力します。保存後、再起動せずにモデルを選択できます。「ピン留め」でセレクターの先頭に表示されます。',
        '手動登録の画像入力や思考機能は、APIとモデルの対応状況に合わせて指定してください。設定した機能が実際に動作するかは、モデルを選んで確認します。ChatGPTプランの接続は、別のサブスクリプション欄から行います。'],
      ['language','表示言語','設定の「一般」にあるLanguage / 言語でシステム設定、English、日本語を選びます。システム設定はブラウザーの優先言語に従い、未対応の言語では英語を表示します。変更を適用すると再読み込みされるため、入力中のメッセージや接続設定は先に保存してください。会話、ファイル名、モデルIDは翻訳されません。'],
      ['files','ファイルと成果物','入力欄にファイルを添付すると、モデルへの画像入力や文書のテキスト変換に使用されます。対応形式はモデルと利用可能な変換ツールに依存します。解析で生成されたファイルは「ファイル」に表示され、ダウンロードできます。読み取れない形式は、対応する変換ツールの導入や別形式への変換が必要です。'],
      ['permissions','ツールのアクセス許可','モデルは研究ハーネスを通してPython、R、ターミナルや接続済みツールを使用します。ツールの承認、ファイルのアクセス範囲、ネットワーク設定はワークスペースの権限に従います。未知のコードを実行する前に、その内容とアクセス先を確認してください。'],
      ['privacy','データと認証情報','会話、ファイル、設定はこのワークスペースのプロファイルに保存されます。モデルへの依頼には、選択したAPIへ会話や添付内容が送信されます。データの取り扱いと利用上限は接続先の規約に従います。',
        '画面で入力したAPIキーとChatGPTの認証情報は、非公開の認証情報フォルダーに暗号化して保存されます。APIキーは画面に再表示されません。APIのURLを変更するときは、キーの送信先も変更されるため、新しいキーを入力するか保存済みのキーを使うことを明示的に選びます。報告機能で保存される情報はローカルの記録です。'],
      ['updates','更新方法','このChimericビルドは、検証済みのランタイムとアセットを組み合わせています。更新前にプロファイル、会話データベース、成果物、認証情報をバックアップしてください。Chimericの新しいパッケージに含まれる移行手順に従って更新します。元の配布元の自動更新は無効です。'],
      ['licenses','ライセンス','Chimericは既存のローカル研究ランタイムを統合しています。各コンポーネントの権利表記とライセンスは、その配布物および「サードパーティーライセンス」に記載されています。製品名の変更によって、元のコンポーネントのライセンスが変更されることはありません。'],
    ]:[
      ['models','Connect an external LLM','Open Settings → Connections. Enter a provider name, API base URL and optional API key. Choose Chat Completions or Responses. Include the path prefix supplied by your provider, such as /v1.',
        'Test discovery reads the endpoint’s /models catalog. If discovery is unavailable, register exact model IDs manually, one per line. Saved models appear without restarting Chimeric. Pin a model to place it at the top of the selector.',
        'Configure image input and reasoning capabilities according to the model and API documentation. Registration does not establish that every capability works; select the model and try a request. Connect a ChatGPT plan using the separate subscription controls.'],
      ['language','Interface language','Open Settings → General → Language / 言語. System follows your browser’s preferred language, using English for unsupported languages. Choose English or 日本語 to override it, then apply the change. Save message drafts and connection edits before the page reloads. Conversations, file names and model IDs retain their original text.'],
      ['files','Files and artifacts','Attach files in the message composer for image input or document text conversion. Supported formats depend on the selected model and installed converters. Files generated during analysis appear in Files and can be downloaded. Unsupported formats require an appropriate converter or conversion to a supported format.'],
      ['permissions','Tool permissions','Models use the research harness to run Python, R, terminal commands and connected tools. Workspace permissions govern approvals, file access and network access. Review unfamiliar code and its destinations before approving execution.'],
      ['privacy','Data and credentials','Conversations, files and settings are stored in the workspace profile. Requests send conversation and attachment content to your selected model endpoint. That provider’s terms and usage limits apply.',
        'API keys entered in Settings and ChatGPT credentials are encrypted in the private authentication directory. Saved API keys are never shown again. Changing an API URL changes the credential destination, so enter a new key or explicitly choose to reuse the saved key. Reports created inside the app are saved locally.'],
      ['updates','Update instructions','This Chimeric build combines a verified runtime and its matching assets. Back up the profile, conversation database, artifacts and credentials before updating. Follow the migration instructions supplied with a new Chimeric package. Automatic updates from the original distributor are disabled.'],
      ['licenses','Licenses','Chimeric integrates an existing local research runtime. Component notices and licenses remain in the distribution and under Third-Party Licenses. Renaming the product does not change the licenses of its underlying components.'],
    ];
    const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
    const title=ja?'Chimeric 設定ガイド':'Chimeric Setup Guide';
    const html='<!doctype html><html lang="'+(ja?'ja':'en')+'"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title><style>html{color-scheme:light dark}body{max-width:760px;margin:0 auto;padding:48px 24px 80px;font:16px/1.75 system-ui,sans-serif;background:#faf9f5;color:#292724}h1{font-size:30px;letter-spacing:-.03em}h2{font-size:21px;margin-top:38px}p{margin:12px 0}a{color:inherit;text-underline-offset:3px}nav{display:flex;flex-wrap:wrap;gap:8px 20px;border-block:1px solid #d8d5cc;padding:16px 0}section{scroll-margin-top:24px}@media(prefers-color-scheme:dark){body{background:#242320;color:#edeae2}nav{border-color:#55534b}}</style><h1>'+title+'</h1><nav>'+sections.map(([id,name])=>'<a href="#'+id+'">'+escape(name)+'</a>').join('')+'</nav>'+sections.map(([id,name,...paragraphs])=>'<section id="'+id+'"><h2>'+escape(name)+'</h2>'+paragraphs.map(p=>'<p>'+escape(p)+'</p>').join('')+'</section>').join('')+'</html>';
    return reply.type('text/html; charset=utf-8').header('cache-control','no-store').header('content-security-policy',"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'").send(html);
  });
}
