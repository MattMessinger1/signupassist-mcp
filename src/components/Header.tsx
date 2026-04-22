import { CreditCard, LogOut, Menu, Settings, ShieldCheck, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { BrandLogo } from '@/components/BrandLogo';
import { isAdminSurfaceEnabled, isTestRoutesEnabled } from '@/lib/featureFlags';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Header() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const adminEnabled = isAdminSurfaceEnabled();
  const testRoutesEnabled = isTestRoutesEnabled();

  return (
    <header className="border-b bg-card">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-6">
          {/* Logo & Brand */}
          <div 
            className="flex items-center gap-2 cursor-pointer" 
            onClick={() => navigate('/')}
          >
            <BrandLogo size="md" variant="light" />
            <span className="text-xl font-semibold text-primary">SignupAssist</span>
          </div>
          
          {/* Desktop Navigation */}
          <nav className="hidden lg:flex items-center space-x-1">
            <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
              Dashboard
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate('/activity-finder')}>
              Find Activity
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate('/run-center')}>
              Run Center
            </Button>
            {testRoutesEnabled && (
              <Button variant="ghost" size="sm" onClick={() => navigate('/mcp-chat-test')}>
                Chat
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => navigate('/mandates')}>
              Receipts
            </Button>
            {adminEnabled && user && (
              <Button variant="ghost" size="sm" onClick={() => navigate('/admin')}>
                Admin
              </Button>
            )}
          </nav>
        </div>

        {/* Right Side */}
        <div className="flex items-center gap-3">
          {user && (
            <nav className="hidden xl:flex items-center gap-1" aria-label="Utility navigation">
              <Button variant="ghost" size="sm" onClick={() => navigate('/chrome-helper/setup')}>
                <ShieldCheck className="h-4 w-4" />
                Chrome Helper
              </Button>
              <Button variant="ghost" size="sm" onClick={() => navigate('/credentials')}>
                <Users className="h-4 w-4" />
                Children
              </Button>
              <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
                <CreditCard className="h-4 w-4" />
                Billing
              </Button>
              <Button variant="ghost" size="sm" onClick={() => navigate('/credentials')}>
                <Settings className="h-4 w-4" />
                Settings
              </Button>
            </nav>
          )}
          {user ? (
            <>
              <span className="text-sm text-muted-foreground hidden sm:inline">
                {user.email}
              </span>
              <Button variant="outline" size="sm" onClick={signOut}>
                <LogOut className="h-4 w-4 mr-2" />
                Sign out
              </Button>
            </>
          ) : (
            <Button variant="accent" size="sm" onClick={() => navigate('/auth')}>
              Sign in
            </Button>
          )}
          
          {/* Mobile Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild className="lg:hidden">
              <Button variant="ghost" size="icon">
                <Menu className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => navigate('/dashboard')}>
                Dashboard
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/activity-finder')}>
                Find Activity
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/run-center')}>
                Run Center
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/chrome-helper/setup')}>
                Chrome Helper
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/credentials')}>
                Children
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/dashboard')}>
                Billing
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/credentials')}>
                Settings
              </DropdownMenuItem>
              {testRoutesEnabled && (
                <DropdownMenuItem onClick={() => navigate('/mcp-chat-test')}>
                  Chat
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => navigate('/mandates')}>
                Receipts
              </DropdownMenuItem>
              {adminEnabled && user && (
                <DropdownMenuItem onClick={() => navigate('/admin')}>
                  Admin
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
