import { LogOut, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

export function Header() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="border-b bg-card">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-6">
          <h1 className="text-xl font-bold cursor-pointer" onClick={() => navigate('/')}>
            SignupBuddy
          </h1>
          <nav className="hidden md:flex space-x-4">
            <Button variant="ghost" onClick={() => navigate('/dashboard')}>
              Dashboard
            </Button>
            <Button variant="ghost" onClick={() => navigate('/plan-builder')}>
              Plan Builder
            </Button>
            <Button variant="ghost" onClick={() => navigate('/credentials')}>
              Credentials
            </Button>
          </nav>
        </div>

        {user && (
          <div className="flex items-center space-x-4">
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {user.email}
            </span>
            <Button variant="outline" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4 mr-2" />
              Sign out
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
