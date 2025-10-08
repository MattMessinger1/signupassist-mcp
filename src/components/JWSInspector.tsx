import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Search, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function JWSInspector() {
  const [jwsToken, setJwsToken] = useState('');
  const [decoded, setDecoded] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const decodeJWT = () => {
    try {
      setError(null);
      if (!jwsToken.trim()) {
        setError('Please enter a JWS token');
        return;
      }

      const parts = jwsToken.split('.');
      if (parts.length !== 3) {
        setError('Invalid JWS format. Expected 3 parts separated by dots.');
        return;
      }

      const [headerB64, payloadB64, signature] = parts;
      
      const header = JSON.parse(atob(headerB64));
      const payload = JSON.parse(atob(payloadB64));

      const now = Math.floor(Date.now() / 1000);
      const isExpired = payload.exp && payload.exp < now;
      const notYetValid = payload.iat && payload.iat > now;

      setDecoded({
        header,
        payload,
        signature: signature.substring(0, 20) + '...',
        isExpired,
        notYetValid,
        expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
        issuedAt: payload.iat ? new Date(payload.iat * 1000).toISOString() : null
      });
    } catch (err) {
      console.error('Error decoding JWT:', err);
      setError('Failed to decode token. Make sure it\'s a valid JWS.');
      setDecoded(null);
    }
  };

  const getValidityStatus = () => {
    if (!decoded) return null;
    if (decoded.notYetValid) {
      return { icon: AlertCircle, color: 'secondary', text: 'Not Yet Valid' };
    }
    if (decoded.isExpired) {
      return { icon: XCircle, color: 'destructive', text: 'Expired' };
    }
    return { icon: CheckCircle2, color: 'default', text: 'Valid' };
  };

  const status = getValidityStatus();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          JWS Token Inspector
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Textarea
            placeholder="Paste JWS token here..."
            value={jwsToken}
            onChange={(e) => setJwsToken(e.target.value)}
            rows={4}
            className="font-mono text-xs"
          />
          <Button onClick={decodeJWT} className="w-full">
            Decode Token
          </Button>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {decoded && status && (
          <div className="space-y-4 border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Token Status</h3>
              <Badge variant={status.color as any}>
                <status.icon className="h-3 w-3 mr-1" />
                {status.text}
              </Badge>
            </div>

            <div className="space-y-3">
              <div>
                <h4 className="text-sm font-medium mb-2">Header</h4>
                <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
                  {JSON.stringify(decoded.header, null, 2)}
                </pre>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-2">Payload</h4>
                <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
                  {JSON.stringify(decoded.payload, null, 2)}
                </pre>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                {decoded.issuedAt && (
                  <div>
                    <span className="text-muted-foreground">Issued At:</span>
                    <p className="font-medium">{decoded.issuedAt}</p>
                  </div>
                )}
                {decoded.expiresAt && (
                  <div>
                    <span className="text-muted-foreground">Expires At:</span>
                    <p className="font-medium">{decoded.expiresAt}</p>
                  </div>
                )}
              </div>

              <div>
                <span className="text-sm text-muted-foreground">Signature (truncated):</span>
                <p className="text-xs font-mono mt-1">{decoded.signature}</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}