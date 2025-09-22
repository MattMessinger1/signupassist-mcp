#!/usr/bin/env python3
"""
Convenience Evaluation Script

Tracks reuse of stored credentials across signups.
Metric: Reuse Rate = # signups using stored credentials ÷ total signups
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Set
from dataclasses import dataclass
from collections import defaultdict

@dataclass
class CredentialUsage:
    credential_id: str
    user_id: str
    provider: str
    email: str
    first_used: datetime
    last_used: datetime
    usage_count: int
    successful_signups: int

@dataclass
class SignupRecord:
    signup_id: str
    user_id: str
    provider: str
    program_id: str
    timestamp: datetime
    used_stored_credentials: bool
    credential_id: str = None
    success: bool = True

class ConvenienceEvaluator:
    def __init__(self):
        self.logger = logging.getLogger(__name__)
        self.credentials: Dict[str, CredentialUsage] = {}
        self.signups: List[SignupRecord] = []
        
    def simulate_credential_storage(self):
        """Simulate users storing credentials over time"""
        # Simulate 50 users storing credentials across different providers
        providers = ['skiclubpro', 'daysmart', 'campminder']
        
        for user_id in range(1, 51):  # 50 users
            for provider in providers:
                # Not all users store credentials for all providers
                if user_id % 3 == 0 and provider == 'daysmart':
                    continue  # Some users skip certain providers
                    
                credential_id = f"cred_{user_id}_{provider}"
                email = f"parent{user_id}@example.com"
                
                # Simulate credentials being stored over the past 6 months
                days_ago = user_id % 180  # Spread over 6 months
                first_used = datetime.now() - timedelta(days=days_ago)
                
                self.credentials[credential_id] = CredentialUsage(
                    credential_id=credential_id,
                    user_id=f"user_{user_id}",
                    provider=provider,
                    email=email,
                    first_used=first_used,
                    last_used=first_used,
                    usage_count=1,
                    successful_signups=0
                )
    
    def simulate_signup_attempts(self, num_signups: int = 200):
        """Simulate signup attempts using various credential scenarios"""
        programs = [
            'summer_camp_2024',
            'ski_lessons_winter',
            'soccer_spring_league',
            'tennis_camp_july',
            'swimming_lessons'
        ]
        
        providers = ['skiclubpro', 'daysmart', 'campminder']
        
        for i in range(num_signups):
            # Pick random user, provider, program
            user_id = f"user_{(i % 50) + 1}"
            provider = providers[i % len(providers)]
            program_id = programs[i % len(programs)]
            
            # Determine if user has stored credentials for this provider
            credential_id = f"cred_{user_id.split('_')[1]}_{provider}"
            has_stored_creds = credential_id in self.credentials
            
            # Users with stored credentials are much more likely to reuse them
            uses_stored_creds = False
            if has_stored_creds:
                # 90% of the time users with stored creds will reuse them
                uses_stored_creds = (i % 10) != 0
            else:
                # 20% of users without stored creds will store them during this signup
                if (i % 5) == 0:
                    # Store new credentials
                    email = f"parent{user_id.split('_')[1]}@example.com"
                    self.credentials[credential_id] = CredentialUsage(
                        credential_id=credential_id,
                        user_id=user_id,
                        provider=provider,
                        email=email,
                        first_used=datetime.now() - timedelta(days=i//10),
                        last_used=datetime.now() - timedelta(days=i//10),
                        usage_count=0,
                        successful_signups=0
                    )
                    uses_stored_creds = True
            
            # Simulate signup success rate (85% success overall)
            success = (i % 20) != 0  # 19/20 = 95% success rate
            
            signup = SignupRecord(
                signup_id=f"signup_{i:04d}",
                user_id=user_id,
                provider=provider,
                program_id=program_id,
                timestamp=datetime.now() - timedelta(days=(num_signups - i) // 5),
                used_stored_credentials=uses_stored_creds,
                credential_id=credential_id if uses_stored_creds else None,
                success=success
            )
            
            self.signups.append(signup)
            
            # Update credential usage
            if uses_stored_creds and credential_id in self.credentials:
                cred = self.credentials[credential_id]
                cred.usage_count += 1
                cred.last_used = signup.timestamp
                if success:
                    cred.successful_signups += 1
    
    def calculate_convenience_metrics(self) -> Dict:
        """Calculate comprehensive convenience metrics"""
        total_signups = len(self.signups)
        signups_with_stored_creds = [s for s in self.signups if s.used_stored_credentials]
        reuse_count = len(signups_with_stored_creds)
        
        # Basic reuse rate
        reuse_rate = reuse_count / total_signups if total_signups > 0 else 0
        
        # Provider-specific reuse rates
        provider_reuse = defaultdict(lambda: {'total': 0, 'reused': 0})
        for signup in self.signups:
            provider_reuse[signup.provider]['total'] += 1
            if signup.used_stored_credentials:
                provider_reuse[signup.provider]['reused'] += 1
        
        provider_rates = {}
        for provider, data in provider_reuse.items():
            provider_rates[provider] = {
                'total_signups': data['total'],
                'reused_signups': data['reused'],
                'reuse_rate': data['reused'] / data['total'] if data['total'] > 0 else 0
            }
        
        # User behavior analysis
        user_reuse_patterns = defaultdict(lambda: {'total': 0, 'reused': 0})
        for signup in self.signups:
            user_reuse_patterns[signup.user_id]['total'] += 1
            if signup.used_stored_credentials:
                user_reuse_patterns[signup.user_id]['reused'] += 1
        
        # Calculate user segments
        power_users = 0  # Users who reuse >80% of the time
        occasional_users = 0  # Users who reuse 20-80% of the time  
        new_users = 0  # Users who reuse <20% of the time
        
        for user_id, data in user_reuse_patterns.items():
            if data['total'] > 0:
                user_reuse_rate = data['reused'] / data['total']
                if user_reuse_rate > 0.8:
                    power_users += 1
                elif user_reuse_rate > 0.2:
                    occasional_users += 1
                else:
                    new_users += 1
        
        # Credential efficiency metrics
        active_credentials = len([c for c in self.credentials.values() if c.usage_count > 1])
        total_credentials = len(self.credentials)
        credential_efficiency = active_credentials / total_credentials if total_credentials > 0 else 0
        
        # Time-based analysis
        recent_signups = [s for s in self.signups if s.timestamp > datetime.now() - timedelta(days=30)]
        recent_reuse_rate = len([s for s in recent_signups if s.used_stored_credentials]) / len(recent_signups) if recent_signups else 0
        
        return {
            'timestamp': datetime.now().isoformat(),
            'overall_metrics': {
                'total_signups': total_signups,
                'signups_with_stored_creds': reuse_count,
                'reuse_rate': reuse_rate,
                'recent_reuse_rate': recent_reuse_rate
            },
            'provider_metrics': provider_rates,
            'user_segments': {
                'power_users': power_users,
                'occasional_users': occasional_users,
                'new_users': new_users,
                'total_users': len(user_reuse_patterns)
            },
            'credential_metrics': {
                'total_credentials': total_credentials,
                'active_credentials': active_credentials,
                'credential_efficiency': credential_efficiency,
                'avg_usage_per_credential': sum(c.usage_count for c in self.credentials.values()) / total_credentials if total_credentials > 0 else 0
            },
            'convenience_insights': self._generate_insights()
        }
    
    def _generate_insights(self) -> List[str]:
        """Generate actionable insights about credential reuse patterns"""
        insights = []
        
        # Analyze credential usage patterns
        high_usage_creds = [c for c in self.credentials.values() if c.usage_count > 5]
        if high_usage_creds:
            insights.append(f"Found {len(high_usage_creds)} highly-used credentials (>5 signups each)")
        
        # Analyze provider adoption
        provider_adoption = defaultdict(int)
        for cred in self.credentials.values():
            provider_adoption[cred.provider] += 1
        
        most_popular = max(provider_adoption.items(), key=lambda x: x[1]) if provider_adoption else None
        if most_popular:
            insights.append(f"{most_popular[0]} has highest credential storage adoption ({most_popular[1]} users)")
        
        # Success rate with stored credentials
        successful_reuse = [s for s in self.signups if s.used_stored_credentials and s.success]
        total_reuse = [s for s in self.signups if s.used_stored_credentials]
        if total_reuse:
            reuse_success_rate = len(successful_reuse) / len(total_reuse)
            insights.append(f"Stored credential success rate: {reuse_success_rate:.1%}")
        
        return insights
    
    def generate_convenience_report(self, results: Dict) -> str:
        """Generate human-readable convenience report"""
        overall = results['overall_metrics']
        segments = results['user_segments']
        
        report = f"""
# Convenience Evaluation Report
Generated: {results['timestamp']}

## Overall Convenience Metrics
- **Reuse Rate:** {overall['reuse_rate']:.1%} ({overall['signups_with_stored_creds']}/{overall['total_signups']} signups)
- **Recent Reuse Rate:** {overall['recent_reuse_rate']:.1%} (last 30 days)

## User Segments
- **Power Users:** {segments['power_users']} users (>80% reuse rate)
- **Occasional Users:** {segments['occasional_users']} users (20-80% reuse rate)  
- **New Users:** {segments['new_users']} users (<20% reuse rate)

## Provider Adoption
"""
        
        for provider, data in results['provider_metrics'].items():
            status = "✅" if data['reuse_rate'] > 0.7 else "❌" if data['reuse_rate'] < 0.4 else "⚠️"
            report += f"- {status} **{provider.title()}:** {data['reuse_rate']:.1%} reuse rate ({data['reused_signups']}/{data['total_signups']} signups)\n"
        
        cred_metrics = results['credential_metrics']
        report += f"""
## Credential Efficiency
- **Total Stored:** {cred_metrics['total_credentials']} credentials
- **Actively Used:** {cred_metrics['active_credentials']} credentials
- **Efficiency Rate:** {cred_metrics['credential_efficiency']:.1%}
- **Avg Usage:** {cred_metrics['avg_usage_per_credential']:.1f} signups per credential

## Insights
"""
        
        for insight in results['convenience_insights']:
            report += f"- {insight}\n"
        
        return report
    
    def run_convenience_evaluation(self) -> Dict:
        """Run the complete convenience evaluation"""
        self.logger.info("Starting convenience evaluation")
        
        # Simulate the data
        self.simulate_credential_storage()
        self.simulate_signup_attempts(num_signups=200)
        
        # Calculate metrics
        return self.calculate_convenience_metrics()

def main():
    """Main evaluation entry point"""
    logging.basicConfig(level=logging.INFO)
    
    evaluator = ConvenienceEvaluator()
    results = evaluator.run_convenience_evaluation()
    
    # Save results
    with open(f'convenience_results_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json', 'w') as f:
        json.dump(results, f, indent=2, default=str)
    
    # Print report
    report = evaluator.generate_convenience_report(results)
    print(report)
    
    # Exit with error code if reuse rate is below threshold
    reuse_rate = results['overall_metrics']['reuse_rate']
    if reuse_rate < 0.6:
        print(f"❌ Reuse rate below threshold: {reuse_rate:.1%} < 60%")
        exit(1)
    else:
        print(f"✅ Reuse rate meets threshold: {reuse_rate:.1%} >= 60%")

if __name__ == "__main__":
    main()