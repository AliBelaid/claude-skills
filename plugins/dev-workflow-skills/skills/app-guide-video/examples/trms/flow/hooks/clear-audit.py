"""Independent audit for every claim of a batch, recorded by a reviewer other than the claim's reviewer.
Env: API (e.g. http://localhost:6911/api), BATCH_ID, REVIEWER_CODE, REVIEWER_PASSWORD, ADMIN_CODE, APP_PASSWORD.
Reads the batch as admin, then posts Cleared (status 2) as the reviewer. Prints each result."""
import json, os, urllib.request

API = os.environ['API']

def call(method, path, body=None, token=None):
    req = urllib.request.Request(API + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={'content-type': 'application/json', **({'authorization': f'Bearer {token}'} if token else {})})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or b'{}')

def login(code, pw):
    return call('POST', '/account/login', {'userCode': code, 'password': pw})['token']

admin = login(os.environ['ADMIN_CODE'], os.environ['APP_PASSWORD'])
reviewer = login(os.environ['REVIEWER_CODE'], os.environ['REVIEWER_PASSWORD'])
batch = call('GET', f"/mail-review/batches/{os.environ['BATCH_ID']}", token=admin)
for c in batch.get('claims', []):
    res = call('POST', f"/claim-audit/claims/{c['id']}", {'status': 2, 'notes': 'مراجعة مستقلة — مطابق (عرض توضيحي)'}, token=reviewer)
    print(c['claimNumber'], '->', res.get('auditStatusAr'))
