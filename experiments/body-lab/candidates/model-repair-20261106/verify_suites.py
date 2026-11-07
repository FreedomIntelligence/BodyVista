"""Serial Windows regression runner. Resume only complete, version-matched cases."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
from verify_release_motions import SOURCES

HERE=Path(__file__).resolve().parent
LAB=HERE.parents[1]
GUARD=LAB/"candidates/library-refresh-20261106"
sys.path.insert(0,str(GUARD))
from resource_guard import available_memory, windows_api, MIB


def main():
    out=HERE/"validation-v5"/"release"
    out.mkdir(exist_ok=True,parents=True)
    ver=HERE/"verify_release_motions.py"
    sys.path.insert(0,str(LAB.parent))
    # Identity only: avoid loading the model into the orchestrator.
    import importlib
    e=importlib.import_module("body-lab.fullbody_engine")
    identity={"model":e.MODEL_ID,"modelSha256":hashlib.sha256(e.MODEL_PATH.read_bytes()).hexdigest(),"computationSha256":e.COMPUTATION_SHA256}
    code=hashlib.sha256(ver.read_bytes()).hexdigest()
    run=out/(identity["computationSha256"][:16]+"-"+code[:10])
    run.mkdir(exist_ok=True)
    kernel=windows_api()
    for group in ("extended","smoke","core","standing","custom"):
        source,pin=SOURCES[group]
        raw=(HERE/source).read_bytes()
        assert hashlib.sha256(raw).hexdigest()==pin
        definition=json.loads(raw)
        cases=definition if isinstance(definition,list) else definition["cases"]
        rows=[]
        attempts=sorted(run.glob(group+"-part-*.json"))
        for part in attempts:
            doc=json.loads(part.read_bytes())
            assert all(doc[k]==v for k,v in identity.items()) and doc["fixtureSha256"]==pin
            rows+=doc["cases"]
        def validate():
            if [r["id"] for r in rows] != [c["id"] for c in cases[:len(rows)]] or any(not r["passed"] for r in rows):
                raise RuntimeError("Coverage gap or failed case: "+group)
        validate()
        while len(rows)<len(cases):
            start=len(rows)
            budget=180
            amount=min(5 if group!="core" else 12,len(cases)-start)
            deadline=time.monotonic()+180
            while available_memory(kernel)/MIB<4950:
                if time.monotonic()>=deadline:
                    print("PAUSE: available physical RAM did not reach startup headroom",flush=True)
                    return 2
                time.sleep(5)
            part=run/f"{group}-part-{start:03d}-{time.time_ns()}.json"
            cmd=[sys.executable,"-B","-X","utf8",str(GUARD/"guard_check.py"),"--seconds",str(budget),
                str(ver),"--suite",group,"--first",str(start),"--count",str(amount),"--output",str(part)]
            child=subprocess.run(cmd,capture_output=True,encoding="utf8",errors="replace")
            print(child.stdout,flush=True)
            if part.exists():
                doc=json.loads(part.read_bytes())
                assert all(doc[k]==v for k,v in identity.items())
                rows+=doc["cases"]
            validate()
            if child.returncode:
                if "保护阈值" not in child.stderr and "内存不足" not in child.stderr:
                    print(child.stderr,flush=True); return 1
                print(f"Reserve protected; saved {group} {len(rows)}/{len(cases)}.",flush=True)
                if len(rows)==start:
                    return 2
            elif len(rows)!=start+amount:
                raise RuntimeError("Incomplete case group")
        final={**identity,"suite":group,"fixtureSha256":pin,"verificationSha256":code,"passed":True,"cases":rows}
        (run/(group+".json")).write_text(json.dumps(final,ensure_ascii=False,indent=2),encoding="utf8")
        print("Complete",group,len(rows),flush=True)
    print("Verified all suites in",run,flush=True)
    return 0


if __name__=="__main__":
    raise SystemExit(main())
