import { Card, CardContent } from '@/components/ui/card';
import { InviteAcceptForm } from './invite-form';

export default function AgentInvitePage({ params }: { params: { token: string } }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-8">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-6 pt-6">
          <div className="space-y-1 text-center">
            <h1 className="text-xl font-semibold">Create agent login</h1>
            <p className="text-sm text-muted-foreground">Set your password to join the company chat inbox.</p>
          </div>
          <InviteAcceptForm token={params.token} />
        </CardContent>
      </Card>
    </main>
  );
}
