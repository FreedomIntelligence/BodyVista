# 自分のパソコンで動作を作成する

オンライン版では、人体モデルを回転させたり、タイムラインを動かして筋張力や関節トルクを確認したりできます。オフライン版をインストールすると、自分で動作を作成し、力を計算できます。動作の編集機能は現在も開発中です。オンライン版とオフライン版は、どちらも BodyVista の上部メニューから言語を切り替えられます。

## Windows でのインストール

Git、Python 3.13、Node.js 22.x（22.12 以降）をインストールし、PowerShell で次のコマンドを実行します。初回は依存パッケージ、人体モデル、動作ライブラリのダウンロードにインターネット接続が必要です。

```powershell
git clone --config core.autocrlf=false --branch v1.2.2 https://github.com/FreedomIntelligence/BodyVista.git BodyVista-v1.2.2
cd BodyVista-v1.2.2
py -3.13 -m venv .venv-fullbody
& ./.venv-fullbody/Scripts/python.exe -m pip install -r experiments/body-lab/candidates/runtime/requirements-lock.txt
& ./.venv-fullbody/Scripts/python.exe -X utf8 tools/install-motion-lab.py --download
npm ci
npm run build
```

## エディターの起動

リポジトリのディレクトリで次のコマンドを実行します。エディターを使っている間は、この PowerShell ウィンドウを開いたままにします。

```powershell
& ./.venv-fullbody/Scripts/python.exe -X utf8 experiments/elbow-lab/server.py --port 4192
```

[ローカルエディターを日本語で開く](http://127.0.0.1:4192/?workspace=muscle-motion&lang=ja)。関節を動かして最初の姿勢を記録し、次の姿勢をキーフレームとして追加します。姿勢の間の時間を設定して力を計算します。動作ファイルのメニューから既存の JSON シーンを読み込み、編集することもできます。

動作を確認するには、[手首を曲げながら前腕を回し、拳を握るサンプル](../experiments/body-lab/examples/custom_right_rotate_bend_make_fist.json)を保存し、エディターに読み込んで計算します。この動作には 50 個のサンプルフレームがあり、計算が成立した各フレームには 740 個の筋腱単位の張力の推定値が表示されます。キーフレーム、負荷、支持条件を変更した場合は再計算してください。
