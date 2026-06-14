import { auth } from '../firebase';

async function getAuthHeaders() {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User is not authenticated (firebase-service-error)');
  }
  const token = await user.getIdToken();
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}

export async function secureCheckin() {
  const headers = await getAuthHeaders();
  const response = await fetch('/api/user/checkin', {
    method: 'POST',
    headers
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Server rejected check-in attempt.');
  }
  return data;
}

export async function secureConvert(amount: number, fingerprint: string, clientInfo: any) {
  const headers = await getAuthHeaders();
  const response = await fetch('/api/user/convert', {
    method: 'POST',
    headers,
    body: JSON.stringify({ amount, fingerprint, clientInfo })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Server rejected token conversion.');
  }
  return data;
}

export async function secureWithdraw(amount: number, method: string, address: string, fingerprint: string, clientInfo: any) {
  const headers = await getAuthHeaders();
  const response = await fetch('/api/user/withdraw', {
    method: 'POST',
    headers,
    body: JSON.stringify({ amount, method, address, fingerprint, clientInfo })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Server rejected withdrawal request.');
  }
  return data;
}

export async function secureAdReward(fingerprint: string, clientInfo: any) {
  const headers = await getAuthHeaders();
  const response = await fetch('/api/user/ad-reward', {
    method: 'POST',
    headers,
    body: JSON.stringify({ fingerprint, clientInfo })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Server rejected ad video reward payout.');
  }
  return data;
}

export async function secureBroadcast(title: string, message: string) {
  const headers = await getAuthHeaders();
  const response = await fetch('/api/admin/broadcast', {
    method: 'POST',
    headers,
    body: JSON.stringify({ title, message })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Server rejected announcement broadcast request.');
  }
  return data;
}

export async function secureApproveWithdrawal(id: string) {
  const headers = await getAuthHeaders();
  const response = await fetch(`/api/admin/withdrawals/${id}/approve`, {
    method: 'POST',
    headers
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Server rejected withdrawal approval process.');
  }
  return data;
}

export async function secureRejectWithdrawal(id: string) {
  const headers = await getAuthHeaders();
  const response = await fetch(`/api/admin/withdrawals/${id}/reject`, {
    method: 'POST',
    headers
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Server rejected withdrawal rejection/refund process.');
  }
  return data;
}

