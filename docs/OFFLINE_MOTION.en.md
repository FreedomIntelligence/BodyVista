# Design movements on your computer

The online player lets you rotate the anatomical model and drag the timeline to inspect muscle tension and joint torque. Install the offline edition to design a movement and calculate its forces. Custom motion editing is still in development. Both editions use the same BodyVista navigation and language selector.

## Install on Windows

Install Git, Python 3.13 and Node.js 22.x (22.12 or later). Run the following commands in PowerShell. The first installation needs an internet connection to download the dependencies, anatomical model and motion library.

```powershell
git clone --config core.autocrlf=false --branch v1.2.2 https://github.com/FreedomIntelligence/BodyVista.git BodyVista-v1.2.2
cd BodyVista-v1.2.2
py -3.13 -m venv .venv-fullbody
& ./.venv-fullbody/Scripts/python.exe -m pip install -r experiments/body-lab/candidates/runtime/requirements-lock.txt
& ./.venv-fullbody/Scripts/python.exe -X utf8 tools/install-motion-lab.py --download
npm ci
npm run build
```

## Start the editor

Run the following command from the repository directory and leave the PowerShell window open while you work.

```powershell
& ./.venv-fullbody/Scripts/python.exe -X utf8 experiments/elbow-lab/server.py --port 4192
```

[Open the local editor in English](http://127.0.0.1:4192/?workspace=muscle-motion&lang=en). Adjust a joint and record the first pose. Add a second pose, set the time between them, then calculate the forces. You can also import a JSON scene from the motion file menu and edit its keyframes.

To check the installation, save the [wrist, forearm and fist example](../experiments/body-lab/examples/custom_right_rotate_bend_make_fist.json) and import it. The scene has 50 sampled frames. Each valid frame reports model estimates for 740 musculotendon units. Recalculate after changing the keyframes, load or support.
