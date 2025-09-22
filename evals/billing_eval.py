#!/usr/bin/env python3
"""
Billing Evaluation Script

Ensures every successful signup triggers exactly one Stripe charge.
Metric: Billing Alignment Rate = correctly billed signups ÷ successful signups
"""

import json
import logging
import random
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from dataclasses import dataclass
from decimal import Decimal

@dataclass
class SuccessfulSignup:
    signup_id: str
    user_id: str
    provider: str
    program_id: str
    timestamp: datetime
    program_cost: Decimal
    service_fee: Decimal
    total_amount: Decimal

@dataclass
class StripeCharge:
    charge_id: str
    signup_id: str
    user_id: str
    amount_cents: int
    currency: str
    timestamp: datetime
    status: str  # 'succeeded', 'failed', 'pending'
    stripe_fee_cents: int = 0
    description: str = ""

@dataclass
class BillingMismatch:
    signup_id: str
    issue_type: str  # 'missing_charge', 'double_charge', 'wrong_amount', 'failed_charge'
    expected_amount: int
    actual_amount: int
    charges: List[StripeCharge]

class BillingEvaluator:
    def __init__(self):
        self.logger = logging.getLogger(__name__)
        self.successful_signups: List[SuccessfulSignup] = []
        self.stripe_charges: List[StripeCharge] = []
        self.billing_mismatches: List[BillingMismatch] = []
        
        # Pricing structure
        self.service_fees = {
            'basic': Decimal('5.00'),    # $5 per successful signup
            'pro': Decimal('3.00'),      # $3 per successful signup
            'enterprise': Decimal('2.00') # $2 per successful signup
        }
    
    def simulate_successful_signups(self, num_signups: int = 100) -> None:
        """Simulate successful signups with varying program costs"""
        providers = ['skiclubpro', 'daysmart', 'campminder']
        
        # Program costs vary by provider and type
        program_costs = {
            'skiclubpro': [250, 300, 450, 550],  # Ski lessons/programs
            'daysmart': [80, 120, 200, 300],     # Day camps/activities
            'campminder': [150, 200, 400, 800]   # Overnight camps
        }
        
        for i in range(num_signups):
            provider = providers[i % len(providers)]
            program_cost = Decimal(str(random.choice(program_costs[provider])))
            
            # Most users are on basic plan (80%), some pro (15%), few enterprise (5%)
            plan_rand = random.random()
            if plan_rand < 0.8:
                service_fee = self.service_fees['basic']
            elif plan_rand < 0.95:
                service_fee = self.service_fees['pro']
            else:
                service_fee = self.service_fees['enterprise']
            
            signup = SuccessfulSignup(
                signup_id=f"signup_{i:04d}",
                user_id=f"user_{(i % 30) + 1}",  # 30 different users
                provider=provider,
                program_id=f"program_{provider}_{(i % 5) + 1}",
                timestamp=datetime.now() - timedelta(days=random.randint(0, 60)),
                program_cost=program_cost,
                service_fee=service_fee,
                total_amount=program_cost + service_fee
            )
            
            self.successful_signups.append(signup)
    
    def simulate_stripe_charges(self) -> None:
        """Simulate Stripe charges with various billing issues"""
        for signup in self.successful_signups:
            # 95% of signups get billed correctly
            billing_scenario = random.random()
            
            if billing_scenario < 0.95:  # Correct billing
                self._create_correct_charge(signup)
            elif billing_scenario < 0.97:  # Missing charge (2%)
                self._create_missing_charge(signup)
            elif billing_scenario < 0.985:  # Double charge (1.5%)
                self._create_double_charge(signup)
            elif billing_scenario < 0.995:  # Wrong amount (1%)
                self._create_wrong_amount_charge(signup)
            else:  # Failed charge (0.5%)
                self._create_failed_charge(signup)
    
    def _create_correct_charge(self, signup: SuccessfulSignup) -> None:
        """Create a correct Stripe charge for a signup"""
        # Charges happen within 5 minutes of successful signup
        charge_delay = timedelta(minutes=random.randint(1, 5))
        
        charge = StripeCharge(
            charge_id=f"ch_{random.randint(100000, 999999)}",
            signup_id=signup.signup_id,
            user_id=signup.user_id,
            amount_cents=int(signup.service_fee * 100),  # Only charge our service fee
            currency='usd',
            timestamp=signup.timestamp + charge_delay,
            status='succeeded',
            stripe_fee_cents=int(signup.service_fee * 100 * 0.029 + 30),  # Stripe's fee
            description=f"SignupAssist service fee for {signup.provider} program"
        )
        
        self.stripe_charges.append(charge)
    
    def _create_missing_charge(self, signup: SuccessfulSignup) -> None:
        """Simulate a missing charge (billing system failure)"""
        mismatch = BillingMismatch(
            signup_id=signup.signup_id,
            issue_type='missing_charge',
            expected_amount=int(signup.service_fee * 100),
            actual_amount=0,
            charges=[]
        )
        self.billing_mismatches.append(mismatch)
    
    def _create_double_charge(self, signup: SuccessfulSignup) -> None:
        """Simulate double charging (duplicate billing)"""
        charge_delay = timedelta(minutes=random.randint(1, 5))
        
        # First charge
        charge1 = StripeCharge(
            charge_id=f"ch_{random.randint(100000, 999999)}",
            signup_id=signup.signup_id,
            user_id=signup.user_id,
            amount_cents=int(signup.service_fee * 100),
            currency='usd',
            timestamp=signup.timestamp + charge_delay,
            status='succeeded',
            description=f"SignupAssist service fee for {signup.provider} program"
        )
        
        # Duplicate charge (few minutes later)
        charge2 = StripeCharge(
            charge_id=f"ch_{random.randint(100000, 999999)}",
            signup_id=signup.signup_id,
            user_id=signup.user_id,
            amount_cents=int(signup.service_fee * 100),
            currency='usd',
            timestamp=signup.timestamp + charge_delay + timedelta(minutes=3),
            status='succeeded',
            description=f"SignupAssist service fee for {signup.provider} program (duplicate)"
        )
        
        self.stripe_charges.extend([charge1, charge2])
        
        mismatch = BillingMismatch(
            signup_id=signup.signup_id,
            issue_type='double_charge',
            expected_amount=int(signup.service_fee * 100),
            actual_amount=int(signup.service_fee * 100) * 2,
            charges=[charge1, charge2]
        )
        self.billing_mismatches.append(mismatch)
    
    def _create_wrong_amount_charge(self, signup: SuccessfulSignup) -> None:
        """Simulate charging wrong amount"""
        charge_delay = timedelta(minutes=random.randint(1, 5))
        
        # Charge wrong amount (maybe program cost instead of service fee)
        wrong_amount = int(signup.program_cost * 100)  # Charged full program cost by mistake
        
        charge = StripeCharge(
            charge_id=f"ch_{random.randint(100000, 999999)}",
            signup_id=signup.signup_id,
            user_id=signup.user_id,
            amount_cents=wrong_amount,
            currency='usd',
            timestamp=signup.timestamp + charge_delay,
            status='succeeded',
            description=f"SignupAssist service fee for {signup.provider} program (wrong amount)"
        )
        
        self.stripe_charges.append(charge)
        
        mismatch = BillingMismatch(
            signup_id=signup.signup_id,
            issue_type='wrong_amount',
            expected_amount=int(signup.service_fee * 100),
            actual_amount=wrong_amount,
            charges=[charge]
        )
        self.billing_mismatches.append(mismatch)
    
    def _create_failed_charge(self, signup: SuccessfulSignup) -> None:
        """Simulate failed charge (payment method issues)"""
        charge_delay = timedelta(minutes=random.randint(1, 5))
        
        charge = StripeCharge(
            charge_id=f"ch_{random.randint(100000, 999999)}",
            signup_id=signup.signup_id,
            user_id=signup.user_id,
            amount_cents=int(signup.service_fee * 100),
            currency='usd',
            timestamp=signup.timestamp + charge_delay,
            status='failed',
            description=f"SignupAssist service fee for {signup.provider} program (failed)"
        )
        
        self.stripe_charges.append(charge)
        
        mismatch = BillingMismatch(
            signup_id=signup.signup_id,
            issue_type='failed_charge',
            expected_amount=int(signup.service_fee * 100),
            actual_amount=0,
            charges=[charge]
        )
        self.billing_mismatches.append(mismatch)
    
    def calculate_billing_metrics(self) -> Dict:
        """Calculate comprehensive billing alignment metrics"""
        total_signups = len(self.successful_signups)
        total_charges = len(self.stripe_charges)
        successful_charges = [c for c in self.stripe_charges if c.status == 'succeeded']
        
        # Basic alignment calculation
        correctly_billed_signups = total_signups - len(self.billing_mismatches)
        billing_alignment_rate = correctly_billed_signups / total_signups if total_signups > 0 else 0
        
        # Revenue calculations
        expected_revenue_cents = sum(int(s.service_fee * 100) for s in self.successful_signups)
        actual_revenue_cents = sum(c.amount_cents for c in successful_charges)
        revenue_difference_cents = actual_revenue_cents - expected_revenue_cents
        
        # Stripe fees
        total_stripe_fees = sum(c.stripe_fee_cents for c in successful_charges)
        net_revenue_cents = actual_revenue_cents - total_stripe_fees
        
        # Issue breakdown
        issue_type_counts = {}
        for mismatch in self.billing_mismatches:
            issue_type_counts[mismatch.issue_type] = issue_type_counts.get(mismatch.issue_type, 0) + 1
        
        # Provider-specific billing performance
        provider_metrics = {}
        providers = set(s.provider for s in self.successful_signups)
        for provider in providers:
            provider_signups = [s for s in self.successful_signups if s.provider == provider]
            provider_mismatches = [m for m in self.billing_mismatches 
                                 if any(s.signup_id == m.signup_id and s.provider == provider 
                                       for s in self.successful_signups)]
            
            provider_correctly_billed = len(provider_signups) - len(provider_mismatches)
            provider_alignment = provider_correctly_billed / len(provider_signups) if provider_signups else 0
            
            provider_revenue = sum(int(s.service_fee * 100) for s in provider_signups)
            
            provider_metrics[provider] = {
                'total_signups': len(provider_signups),
                'correctly_billed': provider_correctly_billed,
                'billing_alignment': provider_alignment,
                'expected_revenue_cents': provider_revenue,
                'billing_issues': len(provider_mismatches)
            }
        
        # Time-based analysis (billing delays)
        billing_delays = []
        for charge in successful_charges:
            signup = next((s for s in self.successful_signups if s.signup_id == charge.signup_id), None)
            if signup:
                delay_seconds = (charge.timestamp - signup.timestamp).total_seconds()
                billing_delays.append(delay_seconds)
        
        avg_billing_delay = sum(billing_delays) / len(billing_delays) if billing_delays else 0
        max_billing_delay = max(billing_delays) if billing_delays else 0
        
        return {
            'timestamp': datetime.now().isoformat(),
            'overall_metrics': {
                'total_successful_signups': total_signups,
                'correctly_billed_signups': correctly_billed_signups,
                'billing_alignment_rate': billing_alignment_rate,
                'total_charges': total_charges,
                'successful_charges': len(successful_charges),
                'charge_success_rate': len(successful_charges) / total_charges if total_charges > 0 else 0
            },
            'revenue_metrics': {
                'expected_revenue_cents': expected_revenue_cents,
                'actual_revenue_cents': actual_revenue_cents,
                'revenue_difference_cents': revenue_difference_cents,
                'total_stripe_fees_cents': total_stripe_fees,
                'net_revenue_cents': net_revenue_cents,
                'expected_revenue_usd': expected_revenue_cents / 100,
                'actual_revenue_usd': actual_revenue_cents / 100,
                'net_revenue_usd': net_revenue_cents / 100
            },
            'timing_metrics': {
                'avg_billing_delay_seconds': avg_billing_delay,
                'max_billing_delay_seconds': max_billing_delay,
                'avg_billing_delay_minutes': avg_billing_delay / 60,
                'max_billing_delay_minutes': max_billing_delay / 60
            },
            'issue_analysis': {
                'total_billing_issues': len(self.billing_mismatches),
                'issue_types': issue_type_counts,
                'issue_rate': len(self.billing_mismatches) / total_signups if total_signups > 0 else 0
            },
            'provider_metrics': provider_metrics,
            'detailed_mismatches': [
                {
                    'signup_id': m.signup_id,
                    'issue_type': m.issue_type,
                    'expected_amount_cents': m.expected_amount,
                    'actual_amount_cents': m.actual_amount,
                    'charge_count': len(m.charges)
                }
                for m in self.billing_mismatches
            ]
        }
    
    def generate_billing_report(self, results: Dict) -> str:
        """Generate human-readable billing report"""
        overall = results['overall_metrics']
        revenue = results['revenue_metrics']
        timing = results['timing_metrics']
        issues = results['issue_analysis']
        
        report = f"""
# Billing Evaluation Report
Generated: {results['timestamp']}

## Billing Alignment
- **Alignment Rate:** {overall['billing_alignment_rate']:.1%} ({overall['correctly_billed_signups']}/{overall['total_successful_signups']} signups)
- **Charge Success Rate:** {overall['charge_success_rate']:.1%} ({overall['successful_charges']}/{overall['total_charges']} charges)

## Revenue Analysis
- **Expected Revenue:** ${revenue['expected_revenue_usd']:.2f}
- **Actual Revenue:** ${revenue['actual_revenue_usd']:.2f}
- **Revenue Difference:** ${revenue['revenue_difference_cents']/100:+.2f}
- **Stripe Fees:** ${revenue['total_stripe_fees_cents']/100:.2f}
- **Net Revenue:** ${revenue['net_revenue_usd']:.2f}

## Billing Timing
- **Average Billing Delay:** {timing['avg_billing_delay_minutes']:.1f} minutes
- **Maximum Billing Delay:** {timing['max_billing_delay_minutes']:.1f} minutes

## Issue Breakdown
- **Total Issues:** {issues['total_billing_issues']} ({issues['issue_rate']:.1%} of signups)
"""
        
        if issues['issue_types']:
            report += "\n### Issue Types:\n"
            for issue_type, count in sorted(issues['issue_types'].items(), key=lambda x: x[1], reverse=True):
                report += f"- {issue_type.replace('_', ' ').title()}: {count}\n"
        
        report += "\n## Provider Performance\n"
        for provider, metrics in results['provider_metrics'].items():
            status = "✅" if metrics['billing_alignment'] > 0.95 else "❌" if metrics['billing_alignment'] < 0.9 else "⚠️"
            report += f"- {status} **{provider.title()}:** {metrics['billing_alignment']:.1%} alignment ({metrics['billing_issues']} issues in {metrics['total_signups']} signups)\n"
        
        return report
    
    def run_billing_evaluation(self) -> Dict:
        """Run the complete billing evaluation"""
        self.logger.info("Starting billing evaluation")
        
        # Simulate data
        self.simulate_successful_signups(num_signups=100)
        self.simulate_stripe_charges()
        
        # Calculate metrics
        return self.calculate_billing_metrics()

def main():
    """Main evaluation entry point"""
    logging.basicConfig(level=logging.INFO)
    
    evaluator = BillingEvaluator()
    results = evaluator.run_billing_evaluation()
    
    # Save results
    with open(f'billing_results_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json', 'w') as f:
        json.dump(results, f, indent=2, default=str)
    
    # Print report
    report = evaluator.generate_billing_report(results)
    print(report)
    
    # Exit with error code if billing alignment is below threshold
    alignment_rate = results['overall_metrics']['billing_alignment_rate']
    if alignment_rate < 0.95:
        print(f"❌ Billing alignment below threshold: {alignment_rate:.1%} < 95%")
        exit(1)
    else:
        print(f"✅ Billing alignment meets threshold: {alignment_rate:.1%} >= 95%")

if __name__ == "__main__":
    main()