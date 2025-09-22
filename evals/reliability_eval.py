#!/usr/bin/env python3
"""
Reliability Evaluation Script

Logs failures, retries, manual interventions per 100 signups.
Metric: Failure Rate, MTBF (Mean Time Between Failures), Recovery Time
"""

import json
import logging
import random
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from dataclasses import dataclass
from enum import Enum

class FailureType(Enum):
    AUTHENTICATION_FAILED = "authentication_failed"
    NETWORK_TIMEOUT = "network_timeout"
    PAYMENT_DECLINED = "payment_declined"
    PROGRAM_FULL = "program_full"
    SITE_MAINTENANCE = "site_maintenance"
    CAPTCHA_CHALLENGE = "captcha_challenge"
    RATE_LIMITED = "rate_limited"
    FORM_VALIDATION_ERROR = "form_validation_error"

class InterventionType(Enum):
    MANUAL_LOGIN = "manual_login"
    CREDENTIAL_UPDATE = "credential_update"
    PAYMENT_METHOD_UPDATE = "payment_method_update"
    CUSTOMER_SUPPORT = "customer_support"
    SYSTEM_RESTART = "system_restart"

@dataclass
class FailureIncident:
    incident_id: str
    signup_id: str
    provider: str
    failure_type: FailureType
    timestamp: datetime
    resolved: bool = False
    resolution_time: Optional[datetime] = None
    retry_count: int = 0
    manual_intervention: bool = False
    intervention_type: Optional[InterventionType] = None
    error_message: str = ""

@dataclass
class SignupAttempt:
    signup_id: str
    user_id: str
    provider: str
    program_id: str
    timestamp: datetime
    success: bool
    failure_incident: Optional[FailureIncident] = None
    retry_of: Optional[str] = None  # Original signup_id if this is a retry

class ReliabilityEvaluator:
    def __init__(self):
        self.logger = logging.getLogger(__name__)
        self.signup_attempts: List[SignupAttempt] = []
        self.failure_incidents: List[FailureIncident] = []
        
    def simulate_signup_attempts(self, num_attempts: int = 100) -> None:
        """Simulate signup attempts with realistic failure patterns"""
        providers = ['skiclubpro', 'daysmart', 'campminder']
        
        for i in range(num_attempts):
            signup_id = f"signup_{i:04d}"
            user_id = f"user_{(i % 20) + 1}"  # 20 different users
            provider = providers[i % len(providers)]
            program_id = f"program_{(i % 10) + 1}"
            
            # Simulate timestamps over the past 30 days
            timestamp = datetime.now() - timedelta(days=random.randint(0, 30))
            
            # Determine if this signup will fail (realistic 15% failure rate)
            will_fail = random.random() < 0.15
            
            if will_fail:
                failure_incident = self._generate_failure_incident(signup_id, provider, timestamp)
                self.failure_incidents.append(failure_incident)
                
                signup = SignupAttempt(
                    signup_id=signup_id,
                    user_id=user_id,
                    provider=provider,
                    program_id=program_id,
                    timestamp=timestamp,
                    success=False,
                    failure_incident=failure_incident
                )
                
                # Simulate retries for some failures
                self._simulate_retries(signup, failure_incident)
                
            else:
                signup = SignupAttempt(
                    signup_id=signup_id,
                    user_id=user_id,
                    provider=provider,
                    program_id=program_id,
                    timestamp=timestamp,
                    success=True
                )
            
            self.signup_attempts.append(signup)
    
    def _generate_failure_incident(self, signup_id: str, provider: str, timestamp: datetime) -> FailureIncident:
        """Generate a realistic failure incident"""
        # Different providers have different failure patterns
        if provider == 'skiclubpro':
            failure_types = [
                (FailureType.AUTHENTICATION_FAILED, 0.3),
                (FailureType.RATE_LIMITED, 0.2),
                (FailureType.NETWORK_TIMEOUT, 0.2),
                (FailureType.PAYMENT_DECLINED, 0.15),
                (FailureType.SITE_MAINTENANCE, 0.1),
                (FailureType.CAPTCHA_CHALLENGE, 0.05)
            ]
        elif provider == 'daysmart':
            failure_types = [
                (FailureType.FORM_VALIDATION_ERROR, 0.25),
                (FailureType.PROGRAM_FULL, 0.25),
                (FailureType.NETWORK_TIMEOUT, 0.2),
                (FailureType.AUTHENTICATION_FAILED, 0.15),
                (FailureType.PAYMENT_DECLINED, 0.15)
            ]
        else:  # campminder
            failure_types = [
                (FailureType.PROGRAM_FULL, 0.4),
                (FailureType.PAYMENT_DECLINED, 0.2),
                (FailureType.NETWORK_TIMEOUT, 0.2),
                (FailureType.AUTHENTICATION_FAILED, 0.2)
            ]
        
        # Select failure type based on weights
        rand = random.random()
        cumulative = 0
        failure_type = FailureType.NETWORK_TIMEOUT  # default
        for ft, weight in failure_types:
            cumulative += weight
            if rand <= cumulative:
                failure_type = ft
                break
        
        incident_id = f"incident_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{random.randint(1000, 9999)}"
        
        # Determine if manual intervention is needed
        manual_intervention_required = failure_type in [
            FailureType.CAPTCHA_CHALLENGE,
            FailureType.SITE_MAINTENANCE,
            FailureType.AUTHENTICATION_FAILED
        ]
        
        intervention_type = None
        if manual_intervention_required:
            if failure_type == FailureType.CAPTCHA_CHALLENGE:
                intervention_type = InterventionType.MANUAL_LOGIN
            elif failure_type == FailureType.AUTHENTICATION_FAILED:
                intervention_type = InterventionType.CREDENTIAL_UPDATE
            elif failure_type == FailureType.SITE_MAINTENANCE:
                intervention_type = InterventionType.CUSTOMER_SUPPORT
        
        return FailureIncident(
            incident_id=incident_id,
            signup_id=signup_id,
            provider=provider,
            failure_type=failure_type,
            timestamp=timestamp,
            manual_intervention=manual_intervention_required,
            intervention_type=intervention_type,
            error_message=self._get_error_message(failure_type)
        )
    
    def _get_error_message(self, failure_type: FailureType) -> str:
        """Get realistic error message for failure type"""
        messages = {
            FailureType.AUTHENTICATION_FAILED: "Invalid username or password",
            FailureType.NETWORK_TIMEOUT: "Request timed out after 30 seconds",
            FailureType.PAYMENT_DECLINED: "Payment was declined by your bank",
            FailureType.PROGRAM_FULL: "This program is currently full",
            FailureType.SITE_MAINTENANCE: "Site is under maintenance",
            FailureType.CAPTCHA_CHALLENGE: "CAPTCHA verification required",
            FailureType.RATE_LIMITED: "Too many requests, please try again later",
            FailureType.FORM_VALIDATION_ERROR: "Please check all required fields"
        }
        return messages.get(failure_type, "Unknown error occurred")
    
    def _simulate_retries(self, original_signup: SignupAttempt, incident: FailureIncident) -> None:
        """Simulate retry attempts for failed signups"""
        retry_count = 0
        max_retries = 3
        
        # Some failure types don't warrant retries
        if incident.failure_type in [FailureType.PROGRAM_FULL, FailureType.PAYMENT_DECLINED]:
            return
        
        while retry_count < max_retries and not incident.resolved:
            retry_count += 1
            retry_id = f"{original_signup.signup_id}_retry_{retry_count}"
            
            # Retries happen with some delay
            retry_timestamp = incident.timestamp + timedelta(minutes=retry_count * 5)
            
            # Retries have higher success rate (80%)
            retry_success = random.random() < 0.8
            
            if retry_success:
                incident.resolved = True
                incident.resolution_time = retry_timestamp
                incident.retry_count = retry_count
                
                # Create successful retry attempt
                retry_signup = SignupAttempt(
                    signup_id=retry_id,
                    user_id=original_signup.user_id,
                    provider=original_signup.provider,
                    program_id=original_signup.program_id,
                    timestamp=retry_timestamp,
                    success=True,
                    retry_of=original_signup.signup_id
                )
                self.signup_attempts.append(retry_signup)
                break
            else:
                # Create failed retry attempt
                retry_signup = SignupAttempt(
                    signup_id=retry_id,
                    user_id=original_signup.user_id,
                    provider=original_signup.provider,
                    program_id=original_signup.program_id,
                    timestamp=retry_timestamp,
                    success=False,
                    retry_of=original_signup.signup_id
                )
                self.signup_attempts.append(retry_signup)
        
        # If still not resolved after retries, mark as requiring manual intervention
        if not incident.resolved:
            incident.manual_intervention = True
            if not incident.intervention_type:
                incident.intervention_type = InterventionType.CUSTOMER_SUPPORT
    
    def calculate_reliability_metrics(self) -> Dict:
        """Calculate comprehensive reliability metrics"""
        total_attempts = len(self.signup_attempts)
        failed_attempts = [a for a in self.signup_attempts if not a.success]
        successful_attempts = [a for a in self.signup_attempts if a.success]
        
        # Basic failure rate
        failure_rate = len(failed_attempts) / total_attempts if total_attempts > 0 else 0
        
        # Retry analysis
        retry_attempts = [a for a in self.signup_attempts if a.retry_of is not None]
        original_failures = [a for a in self.signup_attempts if not a.success and a.retry_of is None]
        successful_retries = [a for a in retry_attempts if a.success]
        
        retry_success_rate = len(successful_retries) / len(original_failures) if original_failures else 0
        
        # Mean Time Between Failures (MTBF)
        if len(failed_attempts) > 1:
            failure_times = [a.timestamp for a in failed_attempts]
            failure_times.sort()
            time_deltas = [failure_times[i+1] - failure_times[i] for i in range(len(failure_times)-1)]
            avg_time_between_failures = sum(time_deltas, timedelta()) / len(time_deltas)
            mtbf_hours = avg_time_between_failures.total_seconds() / 3600
        else:
            mtbf_hours = float('inf')
        
        # Recovery time analysis
        resolved_incidents = [i for i in self.failure_incidents if i.resolved]
        if resolved_incidents:
            recovery_times = []
            for incident in resolved_incidents:
                if incident.resolution_time:
                    recovery_time = (incident.resolution_time - incident.timestamp).total_seconds() / 60  # minutes
                    recovery_times.append(recovery_time)
            
            avg_recovery_time = sum(recovery_times) / len(recovery_times) if recovery_times else 0
            max_recovery_time = max(recovery_times) if recovery_times else 0
        else:
            avg_recovery_time = 0
            max_recovery_time = 0
        
        # Failure type breakdown
        failure_type_counts = {}
        for incident in self.failure_incidents:
            failure_type = incident.failure_type.value
            failure_type_counts[failure_type] = failure_type_counts.get(failure_type, 0) + 1
        
        # Manual intervention analysis
        manual_interventions = [i for i in self.failure_incidents if i.manual_intervention]
        intervention_rate = len(manual_interventions) / total_attempts if total_attempts > 0 else 0
        
        intervention_type_counts = {}
        for incident in manual_interventions:
            if incident.intervention_type:
                int_type = incident.intervention_type.value
                intervention_type_counts[int_type] = intervention_type_counts.get(int_type, 0) + 1
        
        # Provider-specific reliability
        provider_metrics = {}
        providers = set(a.provider for a in self.signup_attempts)
        for provider in providers:
            provider_attempts = [a for a in self.signup_attempts if a.provider == provider]
            provider_failures = [a for a in provider_attempts if not a.success]
            
            provider_metrics[provider] = {
                'total_attempts': len(provider_attempts),
                'failures': len(provider_failures),
                'failure_rate': len(provider_failures) / len(provider_attempts) if provider_attempts else 0,
                'success_rate': 1 - (len(provider_failures) / len(provider_attempts)) if provider_attempts else 0
            }
        
        return {
            'timestamp': datetime.now().isoformat(),
            'overall_metrics': {
                'total_attempts': total_attempts,
                'successful_attempts': len(successful_attempts),
                'failed_attempts': len(failed_attempts),
                'failure_rate': failure_rate,
                'success_rate': 1 - failure_rate,
                'mtbf_hours': mtbf_hours if mtbf_hours != float('inf') else 0
            },
            'retry_metrics': {
                'total_retries': len(retry_attempts),
                'successful_retries': len(successful_retries),
                'retry_success_rate': retry_success_rate,
                'avg_retries_per_failure': len(retry_attempts) / len(original_failures) if original_failures else 0
            },
            'recovery_metrics': {
                'avg_recovery_time_minutes': avg_recovery_time,
                'max_recovery_time_minutes': max_recovery_time,
                'resolved_incidents': len(resolved_incidents),
                'total_incidents': len(self.failure_incidents)
            },
            'intervention_metrics': {
                'manual_interventions': len(manual_interventions),
                'intervention_rate': intervention_rate,
                'intervention_types': intervention_type_counts
            },
            'failure_analysis': {
                'failure_types': failure_type_counts,
                'most_common_failure': max(failure_type_counts.items(), key=lambda x: x[1])[0] if failure_type_counts else None
            },
            'provider_metrics': provider_metrics
        }
    
    def generate_reliability_report(self, results: Dict) -> str:
        """Generate human-readable reliability report"""
        overall = results['overall_metrics']
        retry = results['retry_metrics']
        recovery = results['recovery_metrics']
        intervention = results['intervention_metrics']
        
        report = f"""
# Reliability Evaluation Report
Generated: {results['timestamp']}

## Overall Reliability
- **Success Rate:** {overall['success_rate']:.1%} ({overall['successful_attempts']}/{overall['total_attempts']} attempts)
- **Failure Rate:** {overall['failure_rate']:.1%}
- **MTBF:** {overall['mtbf_hours']:.1f} hours

## Recovery Performance
- **Retry Success Rate:** {retry['retry_success_rate']:.1%}
- **Average Recovery Time:** {recovery['avg_recovery_time_minutes']:.1f} minutes
- **Max Recovery Time:** {recovery['max_recovery_time_minutes']:.1f} minutes

## Manual Interventions
- **Intervention Rate:** {intervention['intervention_rate']:.1%} ({intervention['manual_interventions']} per {overall['total_attempts']} signups)
"""
        
        if intervention['intervention_types']:
            report += "\n### Intervention Types:\n"
            for int_type, count in sorted(intervention['intervention_types'].items(), key=lambda x: x[1], reverse=True):
                report += f"- {int_type.replace('_', ' ').title()}: {count}\n"
        
        report += "\n## Provider Reliability\n"
        for provider, metrics in results['provider_metrics'].items():
            status = "✅" if metrics['success_rate'] > 0.9 else "❌" if metrics['success_rate'] < 0.8 else "⚠️"
            report += f"- {status} **{provider.title()}:** {metrics['success_rate']:.1%} success rate ({metrics['failures']} failures in {metrics['total_attempts']} attempts)\n"
        
        if results['failure_analysis']['failure_types']:
            report += "\n## Failure Analysis\n"
            for failure_type, count in sorted(results['failure_analysis']['failure_types'].items(), key=lambda x: x[1], reverse=True)[:5]:
                report += f"- {failure_type.replace('_', ' ').title()}: {count} occurrences\n"
        
        return report
    
    def run_reliability_evaluation(self) -> Dict:
        """Run the complete reliability evaluation"""
        self.logger.info("Starting reliability evaluation")
        
        # Simulate signup attempts with failures
        self.simulate_signup_attempts(num_attempts=100)
        
        # Calculate metrics
        return self.calculate_reliability_metrics()

def main():
    """Main evaluation entry point"""
    logging.basicConfig(level=logging.INFO)
    
    evaluator = ReliabilityEvaluator()
    results = evaluator.run_reliability_evaluation()
    
    # Save results
    with open(f'reliability_results_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json', 'w') as f:
        json.dump(results, f, indent=2, default=str)
    
    # Print report
    report = evaluator.generate_reliability_report(results)
    print(report)
    
    # Exit with error code if reliability is below threshold
    success_rate = results['overall_metrics']['success_rate']
    if success_rate < 0.85:
        print(f"❌ Success rate below threshold: {success_rate:.1%} < 85%")
        exit(1)
    else:
        print(f"✅ Success rate meets threshold: {success_rate:.1%} >= 85%")

if __name__ == "__main__":
    main()